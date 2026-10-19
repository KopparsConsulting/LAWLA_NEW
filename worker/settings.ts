/**
 * Ärendeinställningar som backend saknar fält för – i dag bara huvudprompten
 * (juristens stående instruktion till Lawla för ärendet). Lagras i D1 (binding `DB`).
 *
 * Åtkomstkontroll som för historiken: ärendet hämtas från backend med användarens token.
 *
 *   GET /settings/:projectId            → ProjectSettings
 *   PUT /settings/:projectId {mainPrompt} → ProjectSettings
 */

import { MAIN_PROMPT_MAX, type ProjectSettings } from "../shared/sharing";
import { fetchProjectForUser, isSameOriginRequest, json, readSessionToken, safeJson } from "./lib";

export interface SettingsEnv {
  BACKEND_URL: string;
  DB?: D1Database;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS project_settings (
  project_id INTEGER PRIMARY KEY,
  main_prompt TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);`;

// Per databas-instans, så att tester med ny databas inte ärver en gammal "schemat finns".
const schemaReady = new WeakMap<D1Database, Promise<void>>();
function ensureSchema(db: D1Database): Promise<void> {
  let p = schemaReady.get(db);
  if (!p) {
    p = db.exec(SCHEMA).then(() => undefined);
    schemaReady.set(db, p);
  }
  return p;
}

interface Row {
  main_prompt: string;
  updated_at: string;
}

/** Läser huvudprompten för ett ärende (används även av historiken för ögonblicksbilder). */
export async function readMainPrompt(db: D1Database, projectId: number): Promise<string> {
  await ensureSchema(db);
  const row = await db.prepare("SELECT main_prompt FROM project_settings WHERE project_id = ?").bind(projectId).first<Pick<Row, "main_prompt">>();
  return row?.main_prompt ?? "";
}

export async function handleSettings(request: Request, env: SettingsEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: "Ärendeinställningar är inte aktiverade i den här miljön." }, 503);

  const m = url.pathname.match(/^\/settings\/(\d+)\/?$/);
  if (!m) return json({ error: "Okänd inställnings-route." }, 404);
  const projectId = Number(m[1]);

  const isRead = request.method === "GET";
  if (!isRead && !isSameOriginRequest(request, url)) return json({ error: "Ogiltig förfrågan." }, 403);
  const token = readSessionToken(request);
  if (!token) return json({ error: "Inte inloggad." }, 401);

  const access = await fetchProjectForUser(env, projectId, token);
  if (!access.ok) return access.error;

  await ensureSchema(env.DB);
  const db = env.DB;

  if (isRead) {
    const row = await db.prepare("SELECT main_prompt, updated_at FROM project_settings WHERE project_id = ?").bind(projectId).first<Row>();
    const settings: ProjectSettings = { mainPrompt: row?.main_prompt ?? "", updatedAt: row?.updated_at ?? null };
    return json(settings, 200, { "Cache-Control": "no-store" });
  }

  if (request.method === "PUT") {
    const body = (safeJson(await request.text()) ?? {}) as { mainPrompt?: unknown };
    if (typeof body.mainPrompt !== "string") return json({ error: "mainPrompt måste vara en sträng." }, 400);
    const mainPrompt = body.mainPrompt.trim().slice(0, MAIN_PROMPT_MAX);
    const updatedAt = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO project_settings (project_id, main_prompt, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(project_id) DO UPDATE SET main_prompt = ?2, updated_at = ?3",
      )
      .bind(projectId, mainPrompt, updatedAt)
      .run();
    const settings: ProjectSettings = { mainPrompt, updatedAt };
    return json(settings, 200, { "Cache-Control": "no-store" });
  }

  return json({ error: "Metoden stöds inte." }, 405);
}
