/**
 * Delning av rapporten via unik länk.
 *
 * När juristen delar sparas rapporten som den ser ut just då (markdown + de rättskällor som
 * hänvisningarna pekar på) i D1 under en slumpmässig token. Mottagaren behöver inget konto:
 * `GET /share/view/:token` är öppen, men visar bara det frysta innehållet – aldrig något
 * från backend och inga ärende- eller användar-id:n. Länken kan ges en giltighetstid och
 * återkallas när som helst.
 *
 *   GET    /share/view/:token            → SharedReport        (ingen inloggning)
 *   GET    /share/:projectId             → ShareSummary[]
 *   POST   /share/:projectId  CreateShareRequest → { share: ShareSummary }
 *   DELETE /share/:projectId/:token      → 204  (återkallar – länken slutar fungera)
 */

import {
  SHARE_MARKDOWN_MAX,
  SHARE_MAX_DAYS,
  SHARE_MAX_PER_PROJECT,
  shareStatus,
  type CreateShareRequest,
  type SharedEvidence,
  type SharedReport,
  type ShareSummary,
} from "../shared/sharing";
import { backendFetch, ensureSchema, fetchProjectForUser, isSameOriginRequest, json, randomToken, readSessionToken, safeJson } from "./lib";

export interface ShareEnv {
  BACKEND_URL: string;
  DB?: D1Database;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS report_shares (
    token TEXT PRIMARY KEY,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    label TEXT,
    markdown TEXT NOT NULL,
    evidence TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT,
    expires_at TEXT,
    revoked_at TEXT,
    views INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS report_shares_project ON report_shares (project_id, created_at)",
];


interface Row {
  token: string;
  project_id: number;
  title: string;
  label: string | null;
  markdown?: string;
  evidence?: string;
  created_at: string;
  created_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  views: number;
}

const SUMMARY_COLS = "token, project_id, title, label, created_at, created_by, expires_at, revoked_at, views";

function toSummary(r: Row): ShareSummary {
  return {
    token: r.token,
    label: r.label,
    title: r.title,
    createdAt: r.created_at,
    createdBy: r.created_by,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    views: r.views,
  };
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function cleanEvidence(input: unknown): SharedEvidence[] {
  if (!Array.isArray(input)) return [];
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  return input
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && typeof (e as { id?: unknown }).id === "number")
    .slice(0, 500)
    .map((e) => ({
      id: e.id as number,
      displayLabel: str(e.displayLabel, 300),
      documentTitle: str(e.documentTitle, 300),
      content: str(e.content, 20_000),
      annotation: str(e.annotation, 2000),
      chapter: str(e.chapter, 200),
      paragraph: str(e.paragraph, 200),
    }));
}

/** Namn på den som delar, från backend (så att det inte går att förfalska från klienten). */
async function lookupUserName(env: ShareEnv, token: string): Promise<string | null> {
  try {
    const res = await backendFetch(env, "/api/Auth/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { name?: string | null; email?: string | null };
    return user.name || user.email || null;
  } catch {
    return null;
  }
}

export async function handleShare(request: Request, env: ShareEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: "Delning är inte aktiverad i den här miljön." }, 503);
  await ensureSchema(env.DB, "share", SCHEMA);
  const db = env.DB;

  /* ─── Publik vy ─────────────────────────────────────────────────────── */
  const view = url.pathname.match(/^\/share\/view\/([^/]+)\/?$/);
  if (view) {
    if (request.method !== "GET") return json({ error: "Metoden stöds inte." }, 405);
    const token = view[1]!;
    const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
    if (!TOKEN_RE.test(token)) return json({ error: "Länken är ogiltig." }, 404, headers);
    const row = await db.prepare("SELECT * FROM report_shares WHERE token = ?").bind(token).first<Row>();
    if (!row) return json({ error: "Länken finns inte eller har tagits bort." }, 404, headers);
    const status = shareStatus({ expiresAt: row.expires_at, revokedAt: row.revoked_at });
    if (status === "revoked") return json({ error: "Länken har återkallats av den som delade rapporten." }, 410, headers);
    if (status === "expired") return json({ error: "Länken har gått ut." }, 410, headers);
    await db.prepare("UPDATE report_shares SET views = views + 1 WHERE token = ?").bind(token).run();
    const report: SharedReport = {
      title: row.title,
      markdown: row.markdown ?? "",
      evidence: (safeJson(row.evidence ?? "[]") as SharedEvidence[] | null) ?? [],
      createdAt: row.created_at,
      createdBy: row.created_by,
      expiresAt: row.expires_at,
    };
    return json(report, 200, headers);
  }

  /* ─── Juristens hantering av länkar ─────────────────────────────────── */
  const m = url.pathname.match(/^\/share\/(\d+)(?:\/([^/]+))?\/?$/);
  if (!m) return json({ error: "Okänd delnings-route." }, 404);
  const projectId = Number(m[1]);
  const token = m[2] ?? null;

  const isRead = request.method === "GET";
  if (!isRead && !isSameOriginRequest(request, url)) return json({ error: "Ogiltig förfrågan." }, 403);
  const session = readSessionToken(request);
  if (!session) return json({ error: "Inte inloggad." }, 401);

  const access = await fetchProjectForUser(env, projectId, session);
  if (!access.ok) return access.error;

  if (isRead && token == null) {
    const { results } = await db
      .prepare(`SELECT ${SUMMARY_COLS} FROM report_shares WHERE project_id = ? ORDER BY created_at DESC`)
      .bind(projectId)
      .all<Row>();
    return json(results.map(toSummary), 200, { "Cache-Control": "no-store" });
  }

  if (request.method === "POST" && token == null) {
    const body = (safeJson(await request.text()) ?? {}) as Partial<CreateShareRequest>;
    if (typeof body.markdown !== "string" || !body.markdown.trim()) return json({ error: "Rapporten är tom." }, 400);
    if (body.markdown.length > SHARE_MARKDOWN_MAX) return json({ error: "Rapporten är för stor för att delas." }, 413);
    const title = (typeof body.title === "string" && body.title.trim().slice(0, 300)) || "Rättsutredning";
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 200) || null : null;
    const days = typeof body.expiresInDays === "number" && Number.isFinite(body.expiresInDays) ? Math.floor(body.expiresInDays) : 0;
    if (days < 0 || days > SHARE_MAX_DAYS) return json({ error: `Giltighetstiden måste vara 0–${SHARE_MAX_DAYS} dagar.` }, 400);

    const active = await db
      .prepare("SELECT COUNT(*) AS n FROM report_shares WHERE project_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)")
      .bind(projectId, new Date().toISOString())
      .first<{ n: number }>();
    if ((active?.n ?? 0) >= SHARE_MAX_PER_PROJECT) return json({ error: "För många aktiva länkar för ärendet. Återkalla någon först." }, 409);

    const now = new Date();
    const createdAt = now.toISOString();
    const expiresAt = days > 0 ? new Date(now.getTime() + days * 86_400_000).toISOString() : null;
    const createdBy = await lookupUserName(env, session);
    const newToken = randomToken();
    await db
      .prepare(
        "INSERT INTO report_shares (token, project_id, title, label, markdown, evidence, created_at, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(newToken, projectId, title, label, body.markdown, JSON.stringify(cleanEvidence(body.evidence)), createdAt, createdBy, expiresAt)
      .run();
    const share: ShareSummary = { token: newToken, label, title, createdAt, createdBy, expiresAt, revokedAt: null, views: 0 };
    return json({ share }, 201);
  }

  if (request.method === "DELETE" && token != null) {
    if (!TOKEN_RE.test(token)) return json({ error: "Länken är ogiltig." }, 404);
    const res = await db
      .prepare("UPDATE report_shares SET revoked_at = ? WHERE token = ? AND project_id = ? AND revoked_at IS NULL")
      .bind(new Date().toISOString(), token, projectId)
      .run();
    const changed = (res as { meta?: { changes?: number } }).meta?.changes;
    if (changed === 0) {
      const exists = await db.prepare("SELECT token FROM report_shares WHERE token = ? AND project_id = ?").bind(token, projectId).first<{ token: string }>();
      if (!exists) return json({ error: "Länken finns inte." }, 404);
    }
    return new Response(null, { status: 204 });
  }

  return json({ error: "Metoden stöds inte." }, 405);
}
