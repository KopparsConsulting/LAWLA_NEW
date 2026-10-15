import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUpstreamHeaders,
  isAllowedApiPath,
  readSessionToken,
  sessionCookie,
} from "./lib";
import worker, { type Env } from "./index";

const env: Env = {
  ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher,
  BACKEND_URL: "https://backend.test",
  APP_ORIGIN: "https://lawla.example",
};
const ORIGIN = "https://lawla.example";

function req(path: string, init: RequestInit & { cookie?: string; csrf?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("Cookie", init.cookie);
  if (init.csrf !== false && init.method && init.method !== "GET") headers.set("x-lawla-request", "1");
  return new Request(ORIGIN + path, { ...init, headers });
}

afterEach(() => vi.restoreAllMocks());

describe("isAllowedApiPath", () => {
  it("släpper igenom appens endpoints oavsett skiftläge", () => {
    expect(isAllowedApiPath("/api/Projects")).toBe(true);
    expect(isAllowedApiPath("/api/Projects/3/legal-issues/2/analyze")).toBe(true);
    expect(isAllowedApiPath("/api/Rag/query-stream")).toBe(true);
    expect(isAllowedApiPath("/api/System/features")).toBe(true);
    expect(isAllowedApiPath("/api/References/document/12/outgoing")).toBe(true);
  });
  it("blockerar admin, pipeline och användare", () => {
    expect(isAllowedApiPath("/api/admin/ai-settings")).toBe(false);
    expect(isAllowedApiPath("/api/pipeline/status")).toBe(false);
    expect(isAllowedApiPath("/api/Users")).toBe(false);
    expect(isAllowedApiPath("/api/ProjectsEvil")).toBe(false);
    expect(isAllowedApiPath("/api/Projects/../Users")).toBe(false);
    expect(isAllowedApiPath("/api/References/unresolved")).toBe(false);
  });
});

describe("cookies", () => {
  it("läser token ur cookie-headern", () => {
    const r = new Request(ORIGIN, { headers: { Cookie: `a=1; ${sessionCookie("abc.def=").split(";")[0]}; b=2` } });
    expect(readSessionToken(r)).toBe("abc.def=");
  });
  it("sessionscookien är httpOnly och Secure", () => {
    expect(sessionCookie("t")).toMatch(/HttpOnly/);
    expect(sessionCookie("t")).toMatch(/Secure/);
  });
  it("skickar aldrig vidare cookies till backend", () => {
    const h = buildUpstreamHeaders(new Headers({ Cookie: "x=1", "Content-Type": "application/json" }), "tok");
    expect(h.get("cookie")).toBeNull();
    expect(h.get("authorization")).toBe("Bearer tok");
  });
});

describe("worker", () => {
  it("kräver inloggning för API-anrop", async () => {
    const res = await worker.fetch(req("/api/Projects"), env);
    expect(res.status).toBe(401);
  });

  it("kräver CSRF-header för skrivande anrop", async () => {
    const res = await worker.fetch(req("/api/Projects", { method: "POST", cookie: "lawla_session=t", csrf: false }), env);
    expect(res.status).toBe(403);
  });

  it("avvisar fel Origin", async () => {
    const res = await worker.fetch(
      req("/api/Projects", { method: "POST", cookie: "lawla_session=t", headers: { Origin: "https://evil.test" } }),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("proxar med Bearer-token från cookien", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { headers: { "content-type": "application/json" } }));
    const res = await worker.fetch(req("/api/Projects?x=1", { cookie: "lawla_session=secret" }), env);
    expect(res.status).toBe(200);
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe("https://backend.test/api/Projects?x=1");
    expect(new Headers(init!.headers).get("authorization")).toBe("Bearer secret");
  });

  it("rensar cookien när backend svarar 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 401 }));
    const res = await worker.fetch(req("/api/Projects", { cookie: "lawla_session=old" }), env);
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });

  it("feature-flaggor kan hämtas utan inloggning", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { headers: { "content-type": "application/json" } }));
    const res = await worker.fetch(req("/api/System/features"), env);
    expect(res.status).toBe(200);
  });

  it("login sätter cookie och returnerar aldrig token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ token: "jwt123", user: { id: 1, email: "a@b.se" } }));
    const res = await worker.fetch(
      req("/auth/login", { method: "POST", body: JSON.stringify({ email: "a@b.se", password: "x" }), headers: { "content-type": "application/json" } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^lawla_session=jwt123;/);
    const body = await res.text();
    expect(body).not.toContain("jwt123");
    expect(JSON.parse(body).user.email).toBe("a@b.se");
  });

  it("registrering som väntar på godkännande sätter ingen cookie", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ token: null, user: null, message: "Väntar på godkännande" }));
    const res = await worker.fetch(req("/auth/register", { method: "POST", body: "{}" }), env);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await res.json() as { message: string }).message).toBe("Väntar på godkännande");
  });

  it("vidarebefordrar backendens felmeddelande vid misslyckad login", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: "Fel lösenord" }, { status: 401 }));
    const res = await worker.fetch(req("/auth/login", { method: "POST", body: "{}" }), env);
    expect(res.status).toBe(401);
    expect((await res.json() as { error: string }).error).toBe("Fel lösenord");
  });

  it("Google-inloggning skickar vidare till backend med retur-URL", async () => {
    const res = await worker.fetch(req("/auth/google"), env);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://backend.test/api/Auth/google");
    expect(loc.searchParams.get("returnUrl")).toBe("https://lawla.example/auth/callback");
  });

  it("strömmar SSE-svar vidare", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('data: {"type":"content","content":"Hej"}\n\n', { headers: { "content-type": "text/event-stream" } }),
    );
    const res = await worker.fetch(req("/api/Rag/query-stream", { method: "POST", cookie: "lawla_session=t", body: "{}" }), env);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("Hej");
  });
});
