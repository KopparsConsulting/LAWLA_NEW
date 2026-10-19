import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleHistory } from "./history";
import { fakeD1 } from "./testdb";
import type { ProjectSnapshot } from "../shared/snapshot";

const ORIGIN = "https://lawla.example";
const env = { BACKEND_URL: "https://backend.test", DB: fakeD1() };

function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", init.cookie ?? "lawla_session=tok");
  if (init.method && init.method !== "GET") headers.set("x-lawla-request", "1");
  return new Request(ORIGIN + path, { ...init, headers });
}
const call = (path: string, init?: RequestInit & { cookie?: string }) => handleHistory(req(path, init), env, new URL(ORIGIN + path));

const project = {
  id: 5,
  title: "Ärende A",
  description: "",
  caseOverview: "Bakgrund",
  status: 0,
  questions: [{ id: 1, text: "Fråga?", sortOrder: 0 }],
  circumstances: [],
  legalIssues: [{ id: 2, text: "Rättsfråga", sortOrder: 0, analysisCount: 0 }],
};
const evidence = [{ id: 9, displayLabel: "NJA 2018 s. 1036", documentTitle: null, documentId: null, chunkId: null, annotation: null }];

function mockBackend(p = project, ev = evidence, analyses: unknown[] = []) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/api/Projects/5")) return Response.json(p);
    if (url.endsWith("/evidence/expanded")) return Response.json(ev);
    if (url.endsWith("/analyses")) return Response.json(analyses);
    return new Response("not found", { status: 404 });
  });
}

beforeEach(() => {
  env.DB = fakeD1();
});
afterEach(() => vi.restoreAllMocks());

describe("history", () => {
  it("svarar 503 utan databas", async () => {
    const res = await handleHistory(req("/history/5"), { BACKEND_URL: "x" }, new URL(ORIGIN + "/history/5"));
    expect(res.status).toBe(503);
  });

  it("kräver inloggning och CSRF-header", async () => {
    expect((await call("/history/5", { cookie: "" })).status).toBe(401);
    const r = new Request(ORIGIN + "/history/5", { method: "POST", headers: { Cookie: "lawla_session=t" } });
    expect((await handleHistory(r, env, new URL(r.url))).status).toBe(403);
  });

  it("släpper inte igenom om backend nekar åtkomst till ärendet", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ message: "Nej" }, { status: 403 }));
    const res = await call("/history/5");
    expect(res.status).toBe(403);
  });

  it("sparar en version byggd från backendens data och listar den", async () => {
    const spy = mockBackend();
    const created = await call("/history/5", { method: "POST", body: JSON.stringify({ label: "Efter möte" }) });
    expect(created.status).toBe(201);
    // Backend anropas med användarens token, aldrig med cookien
    for (const [, init] of spy.mock.calls) expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");

    const list = (await (await call("/history/5")).json()) as { id: number; label: string; trigger: string; counts: { evidence: number } }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ label: "Efter möte", trigger: "manual", counts: { questions: 1, legalIssues: 1, evidence: 1, analyses: 0 } });

    const detail = (await (await call(`/history/5/${list[0]!.id}`)).json()) as { snapshot: ProjectSnapshot };
    expect(detail.snapshot.evidence[0]?.label).toBe("NJA 2018 s. 1036");
    expect(detail.snapshot.caseOverview).toBe("Bakgrund");
  });

  it("skapar inte dubbletter av automatiska versioner när inget ändrats", async () => {
    mockBackend();
    const a = (await (await call("/history/5", { method: "POST", body: JSON.stringify({ trigger: "analysis" }) })).json()) as { created: boolean; version: { id: number } };
    const b = (await (await call("/history/5", { method: "POST", body: JSON.stringify({ trigger: "analysis" }) })).json()) as { created: boolean; version: { id: number } };
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.version.id).toBe(a.version.id);

    vi.restoreAllMocks();
    mockBackend({ ...project, caseOverview: "Ny bakgrund" });
    const c = (await (await call("/history/5", { method: "POST", body: JSON.stringify({ trigger: "analysis" }) })).json()) as { created: boolean };
    expect(c.created).toBe(true);
  });

  it("ger 404 för version som tillhör ett annat ärende", async () => {
    mockBackend();
    await call("/history/5", { method: "POST", body: "{}" });
    const res = await call("/history/5/999");
    expect(res.status).toBe(404);
  });
});
