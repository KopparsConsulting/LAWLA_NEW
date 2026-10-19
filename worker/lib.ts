/** Rena hjälpfunktioner för Workern. Ligger i egen modul eftersom en Worker-entry bara får exportera handlers. */

export const SESSION_COOKIE = "lawla_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 dagar; backend avgör tokenets faktiska giltighet
export const CSRF_HEADER = "x-lawla-request";

/**
 * Backend-endpoints som frontenden får nå. Allt annat (admin, pipeline,
 * ingestion, användarhantering) blockeras i proxyn.
 */
export const ALLOWED_API_PREFIXES = [
  "/api/projects",
  "/api/documents",
  "/api/rag/query-stream",
  "/api/references/document/",
  "/api/system/features",
  "/api/feedback",
];

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

/* ─── Hjälpfunktioner (exporteras för tester) ─────────────────────────── */

export function isAllowedApiPath(pathname: string): boolean {
  const p = pathname.toLowerCase();
  if (p.includes("..") || p.includes("%2e")) return false;
  return ALLOWED_API_PREFIXES.some((prefix) =>
    prefix.endsWith("/") ? p.startsWith(prefix) : p === prefix || p.startsWith(prefix + "/"),
  );
}

/** CSRF-skydd: kräver egen header (kan inte sättas cross-site utan CORS) och matchande Origin om den finns. */
export function isSameOriginRequest(request: Request, url: URL): boolean {
  if (request.headers.get(CSRF_HEADER) !== "1") return false;
  const origin = request.headers.get("Origin");
  return !origin || origin === url.origin;
}

export function buildUpstreamHeaders(incoming: Headers, token: string | null): Headers {
  const headers = new Headers();
  for (const name of ["content-type", "accept", "accept-language"]) {
    const value = incoming.get(name);
    if (value) headers.set(name, value);
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

export function readSessionToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) {
      const value = rest.join("=");
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function backendFetch(env: { BACKEND_URL: string }, path: string, init: RequestInit): Promise<Response> {
  return fetch(new URL(path, env.BACKEND_URL).toString(), init);
}

/**
 * Åtkomstkontroll för Worker-lagrad data (historik, inställningar, delningar):
 * ärendet hämtas från backend med användarens egen token. Får användaren inte se
 * ärendet där, får den inte heller röra det som Workern lagrar om det.
 * Returnerar backendens svar vid lyckad hämtning, annars ett färdigt felsvar.
 */
export async function fetchProjectForUser(
  env: { BACKEND_URL: string },
  projectId: number,
  token: string,
): Promise<{ ok: true; res: Response } | { ok: false; error: Response }> {
  const res = await backendFetch(env, `/api/Projects/${projectId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.ok) return { ok: true, res };
  const text = await res.text();
  const status = res.status === 401 || res.status === 403 || res.status === 404 ? res.status : 502;
  return { ok: false, error: json({ error: extractError(text) || "Ärendet kunde inte hämtas." }, status) };
}

/**
 * Skapar tabeller vid behov. D1:s `exec()` kör en query per rad och klarar därför inte flerradig
 * DDL – statements körs i stället som förberedda satser i en batch. Resultatet memoreras per
 * databas-instans och nyckel, så att tester med ny databas inte ärver "schemat finns".
 */
const schemaReady = new WeakMap<D1Database, Map<string, Promise<void>>>();
export function ensureSchema(db: D1Database, key: string, statements: readonly string[]): Promise<void> {
  let byKey = schemaReady.get(db);
  if (!byKey) {
    byKey = new Map();
    schemaReady.set(db, byKey);
  }
  let p = byKey.get(key);
  if (!p) {
    p = db.batch(statements.map((sql) => db.prepare(sql))).then(() => undefined);
    p.catch(() => byKey!.delete(key)); // försök igen nästa anrop om det gick fel
    byKey.set(key, p);
  }
  return p;
}

/** Slumpmässig URL-säker token (base64url), t.ex. för delningslänkar. */
export function randomToken(bytes = 24): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function withSecurity(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

export function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function extractError(text: string): string {
  const data = safeJson(text) as { message?: string; error?: string; title?: string } | null;
  if (data) return data.message || data.error || data.title || "";
  return text.slice(0, 300);
}
