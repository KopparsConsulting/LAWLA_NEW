import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleShare } from "./share";
import { fakeD1 } from "./testdb";
import type { SharedReport, ShareSummary } from "../shared/sharing";

const ORIGIN = "https://lawla.example";
const env = { BACKEND_URL: "https://backend.test", DB: fakeD1() };

function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", init.cookie ?? "lawla_session=tok");
  if (init.method && init.method !== "GET") headers.set("x-lawla-request", "1");
  return new Request(ORIGIN + path, { ...init, headers });
}
const call = (path: string, init?: RequestInit & { cookie?: string }) => handleShare(req(path, init), env, new URL(ORIGIN + path));
const anon = (path: string) => handleShare(new Request(ORIGIN + path), env, new URL(ORIGIN + path));

function mockBackend(projectOk = true) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/api/Projects/5")) return projectOk ? Response.json({ id: 5 }) : Response.json({ message: "Nej" }, { status: 403 });
    if (url.endsWith("/api/Auth/validate")) return Response.json({ name: "Anna Jurist", email: "anna@example.se" });
    return new Response("not found", { status: 404 });
  });
}

const body = {
  title: "Ärende A",
  markdown: "# Ärende A\n\nEnligt 36 § AvtL kan avtalet jämkas.",
  evidence: [{ id: 9, displayLabel: "36 § AvtL", documentTitle: "Avtalslagen", content: "Avtalsvillkor får jämkas…", annotation: null, chapter: null, paragraph: null }],
  label: "Till klienten",
  expiresInDays: 30,
};

async function create(overrides: Partial<typeof body> = {}) {
  const res = await call("/share/5", { method: "POST", body: JSON.stringify({ ...body, ...overrides }) });
  return { res, data: (await res.json()) as { share: ShareSummary; error?: string } };
}

beforeEach(() => {
  env.DB = fakeD1();
});
afterEach(() => vi.restoreAllMocks());

describe("share", () => {
  it("svarar 503 utan databas", async () => {
    const res = await handleShare(req("/share/5"), { BACKEND_URL: "x" }, new URL(ORIGIN + "/share/5"));
    expect(res.status).toBe(503);
  });

  it("kräver inloggning, CSRF-header och åtkomst till ärendet", async () => {
    expect((await call("/share/5", { cookie: "" })).status).toBe(401);
    const r = new Request(ORIGIN + "/share/5", { method: "POST", headers: { Cookie: "lawla_session=t" } });
    expect((await handleShare(r, env, new URL(r.url))).status).toBe(403);
    mockBackend(false);
    expect((await call("/share/5")).status).toBe(403);
  });

  it("skapar en länk som kan öppnas utan inloggning och visar den frysta rapporten", async () => {
    mockBackend();
    const { res, data } = await create();
    expect(res.status).toBe(201);
    expect(data.share.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(data.share.createdBy).toBe("Anna Jurist");
    expect(data.share.label).toBe("Till klienten");
    expect(data.share.expiresAt).not.toBeNull();

    const view = await anon(`/share/view/${data.share.token}`);
    expect(view.status).toBe(200);
    expect(view.headers.get("X-Robots-Tag")).toContain("noindex");
    const report = (await view.json()) as SharedReport;
    expect(report.title).toBe("Ärende A");
    expect(report.markdown).toContain("36 § AvtL");
    expect(report.evidence[0]?.content).toContain("jämkas");
    expect(report).not.toHaveProperty("projectId");

    // Visningar räknas och syns i juristens lista.
    const list = (await (await call("/share/5")).json()) as ShareSummary[];
    expect(list).toHaveLength(1);
    expect(list[0]?.views).toBe(1);
  });

  it("avvisar okända och ogiltiga tokens", async () => {
    expect((await anon("/share/view/finns-inte-alls-123456")).status).toBe(404);
    expect((await anon("/share/view/kort")).status).toBe(404);
    expect((await anon("/share/view/../../etc")).status).toBe(404);
  });

  it("återkallad länk slutar fungera", async () => {
    mockBackend();
    const { data } = await create();
    const del = await call(`/share/5/${data.share.token}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await anon(`/share/view/${data.share.token}`)).status).toBe(410);
    const list = (await (await call("/share/5")).json()) as ShareSummary[];
    expect(list[0]?.revokedAt).not.toBeNull();
    // Går inte att återkalla någon annans ärendes länk via fel ärende-id.
    expect((await call(`/share/6/${data.share.token}`, { method: "DELETE" })).status).toBe(404);
  });

  it("utgången länk slutar fungera", async () => {
    mockBackend();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T12:00:00Z"));
    const { data } = await create({ expiresInDays: 1 });
    expect((await anon(`/share/view/${data.share.token}`)).status).toBe(200);
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    expect((await anon(`/share/view/${data.share.token}`)).status).toBe(410);
    vi.useRealTimers();
  });

  it("validerar indata", async () => {
    mockBackend();
    expect((await create({ markdown: "  " })).res.status).toBe(400);
    expect((await create({ expiresInDays: 9999 })).res.status).toBe(400);
    expect((await create({ markdown: "x".repeat(500_000) })).res.status).toBe(413);
    // Tills vidare: inget utgångsdatum.
    const { data } = await create({ expiresInDays: 0 });
    expect(data.share.expiresAt).toBeNull();
  });
});
