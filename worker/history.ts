/**
 * Versionshistorik för ärenden.
 *
 * Backend-plattformen saknar versionering, så Workern sparar ögonblicksbilder av
 * ärendet i en D1-databas (binding `DB`). En version skapas när juristen begär det
 * ("Spara version") och automatiskt innan varje analys, så att det alltid går att
 * se vilket underlag en analys byggde på.
 *
 * Åtkomstkontroll: varje anrop verifieras genom att hämta ärendet från backend med
 * användarens egen token. Får användaren inte se ärendet där, får den inte se historiken.
 *
 *   GET  /history/:projectId              → VersionSummary[]
 *   POST /history/:projectId  {label?, trigger?} → { version, created }
 *   GET  /history/:projectId/:versionId   → VersionDetail
 */

import { buildSnapshot, snapshotCounts, snapshotHash, type ProjectSnapshot, type VersionDetail, type VersionSummary, type VersionTrigger } from "../shared/snapshot";
import { backendFetch, extractError, isSameOriginRequest, json, readSessionToken, safeJson } from "./lib";

export interface HistoryEnv {
  BACKEND_URL: string;
  DB?: D1Database;
}

/** Högst så många versioner sparas per ärende; äldre automatiska versioner gallras först. */
export const MAX_VERSIONS = 200;

const SCHEMA = `CREATE TABLE IF NOT EXISTS project_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  label TEXT,
  trigger TEXT NOT NULL,
  hash TEXT NOT NULL,
  counts TEXT NOT NULL,
  snapshot TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS project_versions_project ON project_versions (project_id, id);`;

let schemaReady: Promise<void> | null = null;
function ensureSchema(db: D1Database): Promise<void> {
  schemaReady ??= db.exec(SCHEMA).then(() => undefined);
  return schemaReady;
}

/** Bara för tester: glöm att schemat redan är skapat. */
export function resetSchemaCache() {
  schemaReady = null;
}

interface Row {
  id: number;
  created_at: string;
  label: string | null;
  trigger: string;
  hash: string;
  counts: string;
  snapshot?: string;
}

function toSummary(r: Row): VersionSummary {
  return {
    id: r.id,
    createdAt: r.created_at,
    label: r.label,
    trigger: r.trigger === "analysis" ? "analysis" : "manual",
    counts: JSON.parse(r.counts) as VersionSummary["counts"],
  };
}

export async function handleHistory(request: Request, env: HistoryEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: "Versionshistorik är inte aktiverad i den här miljön." }, 503);

  const m = url.pathname.match(/^\/history\/(\d+)(?:\/(\d+))?\/?$/);
  if (!m) return json({ error: "Okänd historik-route." }, 404);
  const projectId = Number(m[1]);
  const versionId = m[2] ? Number(m[2]) : null;

  const isRead = request.method === "GET";
  if (!isRead && !isSameOriginRequest(request, url)) return json({ error: "Ogiltig förfrågan." }, 403);
  const token = readSessionToken(request);
  if (!token) return json({ error: "Inte inloggad." }, 401);

  // Hämta ärendet från backend – det är både åtkomstkontroll och (för POST) underlaget till versionen.
  const projectRes = await backendFetch(env, `/api/Projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!projectRes.ok) {
    const text = await projectRes.text();
    return json({ error: extractError(text) || "Ärendet kunde inte hämtas." }, projectRes.status === 403 ? 403 : projectRes.status === 404 ? 404 : projectRes.status);
  }

  await ensureSchema(env.DB);
  const db = env.DB;

  if (request.method === "GET" && versionId == null) {
    const { results } = await db
      .prepare("SELECT id, created_at, label, trigger, hash, counts FROM project_versions WHERE project_id = ? ORDER BY id DESC")
      .bind(projectId)
      .all<Row>();
    return json(results.map(toSummary), 200, { "Cache-Control": "no-store" });
  }

  if (request.method === "GET") {
    const row = await db.prepare("SELECT * FROM project_versions WHERE project_id = ? AND id = ?").bind(projectId, versionId).first<Row>();
    if (!row) return json({ error: "Versionen finns inte." }, 404);
    const detail: VersionDetail = { ...toSummary(row), snapshot: JSON.parse(row.snapshot!) as ProjectSnapshot };
    return json(detail, 200, { "Cache-Control": "no-store" });
  }

  if (request.method === "POST" && versionId == null) {
    const body = (safeJson(await request.text()) ?? {}) as { label?: unknown; trigger?: unknown };
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 200) || null : null;
    const trigger: VersionTrigger = body.trigger === "analysis" ? "analysis" : "manual";

    const project = (await projectRes.json()) as Parameters<typeof buildSnapshot>[0];
    const [evidenceRes, analysesRes] = await Promise.all([
      backendFetch(env, `/api/Projects/${projectId}/evidence/expanded`, { headers: { Authorization: `Bearer ${token}` } }),
      backendFetch(env, `/api/Projects/${projectId}/analyses`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const evidence = evidenceRes.ok ? ((await evidenceRes.json()) as Parameters<typeof buildSnapshot>[1]) : [];
    const analyses = analysesRes.ok ? ((await analysesRes.json()) as unknown[]) : [];

    const snapshot = buildSnapshot(project, evidence, analyses.length);
    const hash = snapshotHash(snapshot);

    const latest = await db
      .prepare("SELECT id, created_at, label, trigger, hash, counts FROM project_versions WHERE project_id = ? ORDER BY id DESC LIMIT 1")
      .bind(projectId)
      .first<Row>();
    // Automatiska versioner sparas inte om inget ändrats sedan senast.
    if (latest && latest.hash === hash && trigger === "analysis") {
      return json({ version: toSummary(latest), created: false }, 200);
    }

    const createdAt = new Date().toISOString();
    const counts = JSON.stringify(snapshotCounts(snapshot));
    const inserted = await db
      .prepare("INSERT INTO project_versions (project_id, created_at, label, trigger, hash, counts, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
      .bind(projectId, createdAt, label, trigger, hash, counts, JSON.stringify(snapshot))
      .first<{ id: number }>();

    // Gallra: behåll högst MAX_VERSIONS, ta bort äldsta automatiska versioner först.
    await db
      .prepare(
        `DELETE FROM project_versions WHERE project_id = ?1 AND trigger = 'analysis' AND id IN (
           SELECT id FROM project_versions WHERE project_id = ?1 AND trigger = 'analysis' ORDER BY id ASC
           LIMIT MAX(0, (SELECT COUNT(*) FROM project_versions WHERE project_id = ?1) - ?2))`,
      )
      .bind(projectId, MAX_VERSIONS)
      .run();

    const version: VersionSummary = { id: inserted?.id ?? 0, createdAt, label, trigger, counts: JSON.parse(counts) as VersionSummary["counts"] };
    return json({ version, created: true }, 201);
  }

  return json({ error: "Metoden stöds inte." }, 405);
}
