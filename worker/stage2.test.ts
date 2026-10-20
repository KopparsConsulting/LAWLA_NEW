import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleLagen, latestAmendment } from "./lagen";
import { handleNotes } from "./notes";
import { handleRiksdagen } from "./riksdagen";
import { fakeD1 } from "./testdb";

const ORIGIN = "https://lawla.example";
function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", init.cookie ?? "lawla_session=tok");
  if (init.method && init.method !== "GET") headers.set("x-lawla-request", "1");
  const url = new URL(ORIGIN + path);
  return { request: new Request(url, { ...init, headers }), url };
}
afterEach(() => vi.restoreAllMocks());

const LAW = {
  uri: "https://lagen.nu/2005:716",
  label: "SFS 2005:716",
  title: "Utlänningslag (2005:716)",
  artifact: {
    amendments: [
      { forarbeten: ["Prop. 2004/05:170"], properties: { "dcterms:identifier": "SFS 2005:716" } },
      { forarbeten: ["Prop. 2009/10:190"], properties: { "dcterms:identifier": "SFS 2010:533", "rpubl:andrar": "nuvarande 5 kap. 16 a § betecknas 5 kap. 16 b §; nya 5 kap. 16 a §" } },
    ],
    structure: [{ id: "K5", children: [{ id: "K5P16b", children: [{ id: "K5P16bS1", text: ["Text. ", { text: "Lag (2010:533)." }] }] }] }],
  },
};

describe("förarbeten per bestämmelse", () => {
  it("historik med ny beteckning och propositionernas adresser", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(LAW));
    const { request, url } = req(`/lagen/forarbeten?uri=${encodeURIComponent("https://lagen.nu/2005:716#K5P16b")}`);
    const data = (await (await handleLagen(request, url)).json()) as { lagrum: string; lawSfs: string; history: { kind: string; label: string; propUri: string }[] };
    expect(data.lagrum).toBe("5 kap. 16 b §");
    expect(data.lawSfs).toBe("2005:716");
    expect(data.history.map((h) => [h.kind, h.label, h.propUri])).toEqual([
      ["ny beteckning", "5 kap. 16 b §", "https://lagen.nu/prop/2009/10:190"],
      ["ursprunglig", "5 kap. 16 a §", "https://lagen.nu/prop/2004/05:170"],
    ]);
    expect(latestAmendment(LAW.artifact.structure, "K5P16b")).toBe("2010:533");
  });

  it("kommentar: försöker äldre beteckning om den nya saknas", async () => {
    const md = "## 9 Författningskommentar\n\n### 9.1 Förslaget till utlänningslag\n\n**5 kap.**\n\n**16 a §**\n\nOm anknytning.\n\n## 10 Bilaga";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ uri: "x", title: "Ny utlänningslag", markdown: md }));
    const q = new URLSearchParams({ prop: "Prop. 2004/05:170", law: "2005:716", name: "utlänningslag", lagrum: "5 kap. 16 b §", alt: "5 kap. 16 a §" });
    const { request, url } = req(`/lagen/kommentar?${q}`);
    const data = (await (await handleLagen(request, url)).json()) as { lagrum: string; found: { markdown: string }[]; propUri: string };
    expect(data.lagrum).toBe("5 kap. 16 a §");
    expect(data.found[0]!.markdown).toBe("Om anknytning.");
    expect(data.propUri).toBe("https://lagen.nu/prop/2004/05:170");
  });
});

describe("riksdagen-proxy", () => {
  it("kräver inloggning och giltigt id", async () => {
    const a = req("/riksdagen/doc?id=GS03170", { cookie: "" });
    expect((await handleRiksdagen(a.request, a.url)).status).toBe(401);
    const b = req("/riksdagen/doc?id=../x");
    expect((await handleRiksdagen(b.request, b.url)).status).toBe(400);
  });
  it("find slår upp beteckning och föredrar originalversionen", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ dokumentlista: { dokument: [{ dok_id: "GSB374d2", rm: "2004", beteckning: "74", doktyp: "sou", titel: "X" }, { dok_id: "GSB374", rm: "2004", beteckning: "74", doktyp: "sou", titel: "X" }] } }),
    );
    const { request, url } = req("/riksdagen/find?typ=sou&bet=2004:74");
    const data = (await (await handleRiksdagen(request, url)).json()) as { dokId: string; identifier: string };
    expect(data).toMatchObject({ dokId: "GSB374", identifier: "SOU 2004:74" });
    const called = new URL(String(spy.mock.calls[0]![0]));
    expect(called.host).toBe("data.riksdagen.se");
    expect(called.searchParams.get("rm")).toBe("2004");
  });
});

describe("anteckningar", () => {
  const env = { BACKEND_URL: "https://backend.test", DB: fakeD1() };
  beforeEach(() => {
    env.DB = fakeD1();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const u = String(input);
      if (u.endsWith("/api/Projects/5")) return Response.json({ id: 5 });
      if (u.endsWith("/api/Auth/validate")) return Response.json({ name: "Anders" });
      return Response.json({}, { status: 403 });
    });
  });
  const call = (path: string, init?: RequestInit & { cookie?: string }) => {
    const { request, url } = req(path, init);
    return handleNotes(request, env, url);
  };
  it("spara, läsa, ta bort", async () => {
    expect((await call("/notes/6")).status).toBe(403);
    const put = await call("/notes/5", { method: "PUT", body: JSON.stringify({ sourceKey: "l/2005:716", text: "Kolla 12 kap. 1 §" }) });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { updatedBy: string }).updatedBy).toBe("Anders");
    const list = (await (await call("/notes/5")).json()) as { sourceKey: string; text: string }[];
    expect(list).toMatchObject([{ sourceKey: "l/2005:716", text: "Kolla 12 kap. 1 §" }]);
    expect((await call("/notes/5", { method: "PUT", body: JSON.stringify({ sourceKey: "../x", text: "a" }) })).status).toBe(400);
    expect((await call("/notes/5", { method: "PUT", body: JSON.stringify({ sourceKey: "l/2005:716", text: "  " }) })).status).toBe(204);
    expect(await (await call("/notes/5")).json()).toEqual([]);
  });
});
