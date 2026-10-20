/**
 * Anteckningar per rättskälla i en utredning (arbetsytans flikar). Lagras i D1 eftersom backend
 * saknar motsvarighet. Åtkomst som för historiken: ärendet hämtas från backend med användarens token.
 *
 *   GET /notes/:projectId          → SourceNote[]
 *   PUT /notes/:projectId {sourceKey, text} → SourceNote | 204 (tom text tar bort anteckningen)
 */
import { NOTE_KEY_RE, NOTE_MAX, type SourceNote } from "../shared/notes";
import { backendFetch, ensureSchema, fetchProjectForUser, isSameOriginRequest, json, readSessionToken, safeJson } from "./lib";

export interface NotesEnv {
  BACKEND_URL: string;
  DB?: D1Database;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS source_notes (
    project_id INTEGER NOT NULL,
    source_key TEXT NOT NULL,
    text TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT,
    PRIMARY KEY (project_id, source_key)
  )`,
];

interface Row {
  source_key: string;
  text: string;
  updated_at: string;
  updated_by: string | null;
}

const toNote = (r: Row): SourceNote => ({ sourceKey: r.source_key, text: r.text, updatedAt: r.updated_at, updatedBy: r.updated_by });

export async function handleNotes(request: Request, env: NotesEnv, url: URL): Promise<Response> {
  if (!env.DB) return json({ error: "Anteckningar är inte aktiverade i den här miljön." }, 503);
  const m = url.pathname.match(/^\/notes\/(\d+)\/?$/);
  if (!m) return json({ error: "Okänd anteckningsroute." }, 404);
  const projectId = Number(m[1]);
  const isRead = request.method === "GET";
  if (!isRead && request.method !== "PUT") return json({ error: "Metoden stöds inte." }, 405);
  if (!isRead && !isSameOriginRequest(request, url)) return json({ error: "Ogiltig förfrågan." }, 403);
  const token = readSessionToken(request);
  if (!token) return json({ error: "Inte inloggad." }, 401);
  const access = await fetchProjectForUser(env, projectId, token);
  if (!access.ok) return access.error;
  await ensureSchema(env.DB, "notes", SCHEMA);

  if (isRead) {
    const rows = await env.DB.prepare("SELECT source_key, text, updated_at, updated_by FROM source_notes WHERE project_id = ? ORDER BY updated_at DESC")
      .bind(projectId)
      .all<Row>();
    return json((rows.results ?? []).map(toNote), 200, { "Cache-Control": "no-store" });
  }

  const body = safeJson(await request.text()) as { sourceKey?: unknown; text?: unknown } | null;
  const key = typeof body?.sourceKey === "string" ? body.sourceKey : "";
  const text = typeof body?.text === "string" ? body.text.replace(/\r\n/g, "\n").trimEnd() : null;
  if (!NOTE_KEY_RE.test(key) || text == null) return json({ error: "Ange sourceKey och text." }, 400);
  if (text.length > NOTE_MAX) return json({ error: `Anteckningen får vara högst ${NOTE_MAX} tecken.` }, 400);

  if (!text.trim()) {
    await env.DB.prepare("DELETE FROM source_notes WHERE project_id = ? AND source_key = ?").bind(projectId, key).run();
    return new Response(null, { status: 204 });
  }
  const now = new Date().toISOString();
  const by = await userName(env, token);
  await env.DB.prepare(
    `INSERT INTO source_notes (project_id, source_key, text, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id, source_key) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  )
    .bind(projectId, key, text, now, by)
    .run();
  return json({ sourceKey: key, text, updatedAt: now, updatedBy: by } satisfies SourceNote);
}

async function userName(env: NotesEnv, token: string): Promise<string | null> {
  try {
    const res = await backendFetch(env, "/api/Auth/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    const u = (await res.json()) as { name?: string | null; email?: string | null };
    return u.name || u.email || null;
  } catch {
    return null;
  }
}
