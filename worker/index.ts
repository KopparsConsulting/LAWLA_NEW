/**
 * Lawla – Cloudflare Worker
 *
 * Serverar SPA:n (statiska filer via ASSETS) och fungerar som tunn proxy/BFF
 * mot backend-plattformen. Webbläsaren ser aldrig JWT-token: den ligger i en
 * httpOnly-cookie som Workern översätter till en Authorization-header.
 */

import {
  backendFetch,
  buildUpstreamHeaders,
  clearSessionCookie,
  extractError,
  isAllowedApiPath,
  isSameOriginRequest,
  json,
  readSessionToken,
  safeJson,
  sessionCookie,
  withSecurity,
} from "./lib";

export interface Env {
  ASSETS: Fetcher;
  BACKEND_URL: string;
  /** Publik adress för appen, används som retur-URL vid Google-inloggning. Tom = härleds från requesten. */
  APP_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/auth/")) return withSecurity(await handleAuth(request, env, url));
      if (url.pathname.startsWith("/api/")) return withSecurity(await handleApi(request, env, url));
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error("worker error", err);
      return withSecurity(json({ error: "Tekniskt fel i Lawla-proxyn." }, 502));
    }
  },
} satisfies ExportedHandler<Env>;

/* ─── Auth ────────────────────────────────────────────────────────────── */

async function handleAuth(request: Request, env: Env, url: URL): Promise<Response> {
  const route = `${request.method} ${url.pathname}`;

  // Navigeringar (GET) kan inte bära egen header; övriga kräver CSRF-skydd.
  if (request.method !== "GET" && !isSameOriginRequest(request, url)) {
    return json({ error: "Ogiltig förfrågan." }, 403);
  }

  switch (route) {
    case "POST /auth/login":
      return loginOrRegister(request, env, "/api/Auth/login");
    case "POST /auth/register":
      return loginOrRegister(request, env, "/api/Auth/register");
    case "POST /auth/logout":
      return new Response(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie() } });
    case "GET /auth/me": {
      const token = readSessionToken(request);
      if (!token) return json({ error: "Inte inloggad." }, 401);
      const res = await backendFetch(env, "/api/Auth/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        return json({ error: "Sessionen har gått ut." }, 401, { "Set-Cookie": clearSessionCookie() });
      }
      return json({ user: await res.json() }, 200, { "Cache-Control": "no-store" });
    }
    case "GET /auth/google": {
      const appOrigin = env.APP_ORIGIN || url.origin;
      const target = new URL("/api/Auth/google", env.BACKEND_URL);
      target.searchParams.set("returnUrl", `${appOrigin}/auth/callback`);
      return Response.redirect(target.toString(), 302);
    }
    case "GET /auth/callback": {
      // Backend skickar tillbaka användaren hit med ?token=… efter Google-inloggning.
      const token = url.searchParams.get("token");
      if (!token) return Response.redirect(`${url.origin}/login?error=google`, 302);
      return new Response(null, {
        status: 302,
        headers: { Location: "/", "Set-Cookie": sessionCookie(token) },
      });
    }
    default:
      return json({ error: "Okänd auth-route." }, 404);
  }
}

async function loginOrRegister(request: Request, env: Env, backendPath: string): Promise<Response> {
  const res = await backendFetch(env, backendPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: await request.text(),
  });
  const text = await res.text();
  if (!res.ok) return json({ error: extractError(text) || "Inloggningen misslyckades." }, res.status);

  const data = safeJson(text) as { token?: string | null; user?: unknown; message?: string | null } | null;
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (data?.token) headers["Set-Cookie"] = sessionCookie(data.token);
  // Token returneras aldrig till webbläsaren.
  return json({ user: data?.token ? data.user ?? null : null, message: data?.message ?? null }, 200, headers);
}

/* ─── API-proxy ───────────────────────────────────────────────────────── */

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (!isAllowedApiPath(url.pathname)) return json({ error: "Endpointen är inte tillgänglig." }, 404);

  const isRead = request.method === "GET" || request.method === "HEAD";
  if (!isRead && !isSameOriginRequest(request, url)) return json({ error: "Ogiltig förfrågan." }, 403);

  const token = readSessionToken(request);
  // Feature-flaggor behövs före inloggning (registrering/Google-knapp).
  const isPublic = url.pathname.toLowerCase() === "/api/system/features";
  if (!token && !isPublic) return json({ error: "Inte inloggad." }, 401);

  const headers = buildUpstreamHeaders(request.headers, token);
  const upstream = await backendFetch(env, url.pathname + url.search, {
    method: request.method,
    headers,
    body: isRead ? undefined : request.body,
    // @ts-expect-error – krävs av runtime när body är en ström
    duplex: "half",
  });

  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-length", "cache-control", "content-disposition"]) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (upstream.headers.get("content-type")?.includes("text/event-stream")) {
    responseHeaders.set("Cache-Control", "no-cache");
    responseHeaders.delete("content-length");
  }
  if (upstream.status === 401) responseHeaders.append("Set-Cookie", clearSessionCookie());

  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
