import { afterEach, describe, expect, it, vi } from "vitest";
import { handleLagen, toResolution, trimMarkdown } from "./lagen";
import { isLagenUri, lagenEvidenceLabel, lagenPlainText } from "../shared/lagen";

const ORIGIN = "https://lawla.example";
const COOKIE = "lawla_session=tok";

function req(path: string, init: RequestInit & { cookie?: string | null; csrf?: boolean } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie !== null) headers.set("Cookie", init.cookie ?? COOKIE);
  if (init.csrf !== false && init.method && init.method !== "GET") headers.set("x-lawla-request", "1");
  const url = new URL(ORIGIN + path);
  return { request: new Request(url, { ...init, headers }), url };
}

/** Svar som lagen.nu faktiskt ger (avstämt 2026-10-20). */
const AVTL_36 = {
  query: "36 § AvtL",
  results: [
    {
      uri: "https://lagen.nu/1915:218",
      url: "/1915:218",
      identifier: "SFS 1915:218",
      title: "Lag (1915:218) om avtal och andra rättshandlingar på förmögenhetsrättens område",
      source: "sfs",
      kind: "lag",
      kind_label: "Lag",
      highlight: [],
      pin: { uri: "https://lagen.nu/1915:218#P36", pinpoint: "P36", label: "36 §", highlight: ["Avtalsvillkor får jämkas eller lämnas utan avseende …"] },
      fragments: [],
    },
  ],
  recognized: [],
};
const NJA_FAKE = { query: "NJA 2099 s. 12345", results: [], recognized: [{ uri: "https://lagen.nu/dom/nja/2099s12345", source: "dv", invalid: true }] };
const UNKNOWN = { query: "36 § lagen", results: [], recognized: [] };

function mockLagen(byQuery: Record<string, unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const u = new URL(String(input));
    expect(u.origin).toBe("https://lagen.nu");
    const q = u.searchParams.get("q") ?? u.searchParams.get("uri") ?? "";
    const body = byQuery[q];
    if (body === undefined) return new Response("nope", { status: 500 });
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("toResolution", () => {
  it("bekräftar hänvisning med utpekat textställe", () => {
    const r = toResolution("36 § AvtL", AVTL_36);
    expect(r.status).toBe("found");
    expect(r.uri).toBe("https://lagen.nu/1915:218#P36");
    expect(r.pinLabel).toBe("36 §");
    expect(r.identifier).toBe("SFS 1915:218");
    expect(r.kindLabel).toBe("Lag");
  });
  it("markerar hänvisning som lagen.nu fastställt inte finns", () => {
    const r = toResolution("NJA 2099 s. 12345", NJA_FAKE);
    expect(r.status).toBe("invalid");
    expect(r.url).toBeNull();
  });
  it("okänd när lagen.nu inte kan tolka hänvisningen", () => {
    expect(toResolution("36 § lagen", UNKNOWN).status).toBe("unknown");
  });
});

describe("/lagen-routes", () => {
  it("kräver inloggning", async () => {
    const { request, url } = req("/lagen/resolve?q=x", { cookie: null });
    expect((await handleLagen(request, url)).status).toBe(401);
  });

  it("resolve slår upp hänvisningen hos lagen.nu", async () => {
    const spy = mockLagen({ "36 § AvtL": AVTL_36 });
    const { request, url } = req(`/lagen/resolve?q=${encodeURIComponent("36 § AvtL")}`);
    const res = await handleLagen(request, url);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe("found");
    const init = spy.mock.calls[0]![1] as RequestInit & { cf?: { cacheTtl?: number } };
    expect(new Headers(init.headers).get("User-Agent")).toContain("Lawla");
    expect(init.cf?.cacheTtl).toBeGreaterThan(0);
  });

  it("verify kräver CSRF-header och ger status per hänvisning; fel hos lagen.nu blir 'error'", async () => {
    mockLagen({ "36 § AvtL": AVTL_36, "NJA 2099 s. 12345": NJA_FAKE, "36 § lagen": UNKNOWN });
    const body = JSON.stringify({ texts: ["36 § AvtL", "NJA 2099 s. 12345", "36 § lagen", "SOU 2001:1", "36 § AvtL", ""] });

    const noCsrf = req("/lagen/verify", { method: "POST", body, csrf: false });
    expect((await handleLagen(noCsrf.request, noCsrf.url)).status).toBe(403);

    const { request, url } = req("/lagen/verify", { method: "POST", body });
    const res = await handleLagen(request, url);
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: { query: string; status: string }[] };
    expect(results.map((r) => [r.query, r.status])).toEqual([
      ["36 § AvtL", "found"],
      ["NJA 2099 s. 12345", "invalid"],
      ["36 § lagen", "unknown"],
      ["SOU 2001:1", "error"],
    ]);
  });

  it("verify begränsar antalet hänvisningar", async () => {
    const texts = Array.from({ length: 41 }, (_, i) => `${i + 1} § AvtL`);
    const { request, url } = req("/lagen/verify", { method: "POST", body: JSON.stringify({ texts }) });
    expect((await handleLagen(request, url)).status).toBe(400);
  });

  it("text hämtar bara från lagen.nu och returnerar textstället", async () => {
    const bad = req(`/lagen/text?uri=${encodeURIComponent("https://evil.example/x")}`);
    expect((await handleLagen(bad.request, bad.url)).status).toBe(400);

    const uri = "https://lagen.nu/1915:218#P36";
    mockLagen({
      [uri]: {
        uri: "https://lagen.nu/1915:218",
        source: "sfs",
        label: "SFS 1915:218",
        title: "Lag (1915:218) om avtal",
        inbound_count: 1,
        pinpoint_label: "36 §",
        source_url: "https://beta.rkrattsbaser.gov.se/sfs/item?bet=1915%3A218",
        markdown: "**36 §** Avtalsvillkor får jämkas …",
      },
    });
    const { request, url } = req(`/lagen/text?uri=${encodeURIComponent(uri)}`);
    const res = await handleLagen(request, url);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { pinLabel: string; markdown: string; truncated: boolean };
    expect(data.pinLabel).toBe("36 §");
    expect(data.markdown).toContain("Avtalsvillkor");
    expect(data.truncated).toBe(false);
  });

  it("doc hämtar hela dokumentet utan fragment", async () => {
    const spy = mockLagen({
      "https://lagen.nu/2005:716": { uri: "https://lagen.nu/2005:716", source: "sfs", kind: "lag", label: "SFS 2005:716", title: "Utlänningslag (2005:716)", inbound_count: 1, markdown: "# Utlänningslag\n\n**1 §** Text." },
    });
    const { request, url } = req(`/lagen/doc?uri=${encodeURIComponent("https://lagen.nu/2005:716#K4P1")}`);
    const data = (await (await handleLagen(request, url)).json()) as { uri: string; kind: string; markdown: string; truncated: boolean };
    expect(data).toMatchObject({ uri: "https://lagen.nu/2005:716", kind: "lag", truncated: false });
    expect(data.markdown).toContain("**1 §**");
    expect(new URL(String(spy.mock.calls[0]![0])).searchParams.get("uri")).toBe("https://lagen.nu/2005:716");
  });

  it("search returnerar träffar med textställe", async () => {
    mockLagen({
      oskäligt: {
        query: "oskäligt",
        total: 1,
        results: [{ ...AVTL_36.results[0], highlight: ["<em>oskäligt</em> villkor"] }],
      },
    });
    const { request, url } = req("/lagen/search?q=osk%C3%A4ligt&limit=3");
    const data = (await (await handleLagen(request, url)).json()) as { results: { uri: string; title: string }[] };
    expect(data.results[0]!.uri).toBe("https://lagen.nu/1915:218#P36");
    expect(data.results[0]!.title).toContain("36 §");
  });
});

describe("hjälpfunktioner", () => {
  it("isLagenUri godtar bara https://lagen.nu", () => {
    expect(isLagenUri("https://lagen.nu/1987:230#K12P3")).toBe(true);
    expect(isLagenUri("http://lagen.nu/1987:230")).toBe(false);
    expect(isLagenUri("https://lagen.nu.evil.com/x")).toBe(false);
    expect(isLagenUri("https://user@lagen.nu/x")).toBe(false);
  });
  it("trimMarkdown kortar vid styckesgräns", () => {
    const md = Array.from({ length: 50 }, (_, i) => `Stycke ${i} ${"x".repeat(80)}`).join("\n\n");
    const t = trimMarkdown(md, 1000);
    expect(t.truncated).toBe(true);
    expect(t.markdown.length).toBeLessThanOrEqual(1000);
    expect(t.markdown.endsWith("x")).toBe(true);
  });
  it("etikett för källa från lagen.nu innehåller hänvisningen", () => {
    expect(lagenEvidenceLabel("36 § AvtL", { identifier: "SFS 1915:218", title: "Lag (1915:218) om avtal" })).toBe("36 § AvtL – Lag (1915:218) om avtal");
    expect(lagenEvidenceLabel("NJA 2015 s. 899", { identifier: "NJA 2015 s. 899", title: "NJA 2015 s. 899" })).toBe("NJA 2015 s. 899");
    expect(lagenEvidenceLabel("prop. 2016/17:180", { identifier: "Prop. 2016/17:180", title: "En modern förvaltning" })).toBe(
      "prop. 2016/17:180 – En modern förvaltning (Prop. 2016/17:180)",
    );
  });
  it("lagenPlainText tar bort länkar och fetstil", () => {
    expect(lagenPlainText("**36 §** Se [första stycket](https://lagen.nu/x).")).toBe("36 § Se första stycket.");
  });
});
