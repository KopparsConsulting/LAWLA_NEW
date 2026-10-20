/**
 * Proxy mot lagen.nu:s öppna API (https://lagen.nu/openapi.json) för att verifiera och
 * komplettera hänvisningar som saknas i utredningens underlag.
 *
 *   GET  /lagen/resolve?q=36 § AvtL     → LagenResolution
 *   POST /lagen/verify {texts: [...]}    → { results: LagenResolution[] }
 *   GET  /lagen/text?uri=https://lagen.nu/1915:218#P36 → LagenText
 *   GET  /lagen/search?q=…&limit=5       → LagenSearchResult
 *   GET  /lagen/doc?uri=https://lagen.nu/2005:716 → LagenDocument (hela dokumentet, för arbetsytan)
 *   GET  /lagen/forarbeten?uri=https://lagen.nu/2005:716#K7P18 → ProvisionForarbeten (ändringshistorik)
 *   GET  /lagen/kommentar?prop=Prop. 2025/26:301&law=2005:716&name=utlänningslag&lagrum=5 kap. 18 §[&alt=…]
 *        → ProvisionCommentary (författningskommentaren till bestämmelsen)
 *
 * Varför via Workern: svaren cachas i Cloudflare (samma hänvisning slås upp en gång per dygn
 * oavsett antal användare), bara inloggade användare kan använda proxyn, och lagen.nu får
 * en identifierbar User-Agent. Inga ärendedata skickas – bara själva hänvisningen.
 */

import {
  LAGEN_BASE,
  LAGEN_DOC_MAX,
  LAGEN_QUERY_MAX,
  LAGEN_TEXT_MAX,
  LAGEN_VERIFY_MAX,
  isLagenUri,
  type LagenDocument,
  type LagenResolution,
  type LagenSearchHit,
  type LagenSearchResult,
  type LagenText,
} from "../shared/lagen";
import {
  findCommentary,
  forarbeteUri,
  lagrumFromAnchor,
  lagrumLabel,
  parseLagrumLabel,
  provisionHistory,
  type Amendment,
  type ProvisionCommentary,
  type ProvisionForarbeten,
} from "../shared/forarbeten";
import { isSameOriginRequest, json, readSessionToken, safeJson } from "./lib";

const USER_AGENT = "Lawla/2.0 (+https://lawla.kopparsconsulting.com)";
const TIMEOUT_MS = 8_000;
const TTL_RESOLVE = 60 * 60 * 24; // ett dygn
const TTL_TEXT = 60 * 60 * 24 * 7; // en vecka

/* ─── lagen.nu:s svar (de fält vi använder) ───────────────────────────── */

interface Fragment {
  uri: string;
  pinpoint?: string | null;
  label?: string | null;
  highlight?: string[];
}
interface SearchResult {
  uri: string;
  url?: string | null;
  identifier?: string | null;
  title?: string | null;
  display?: string | null;
  source?: string | null;
  kind_label?: string | null;
  highlight?: string[];
  pin?: Fragment | null;
  fragments?: Fragment[];
}
interface ResolveResponse {
  results?: SearchResult[];
  recognized?: { uri: string; source: string; invalid?: boolean }[];
}
interface SearchResponse {
  total?: number;
  results?: SearchResult[];
}
interface MarkdownDocument {
  uri: string;
  source?: string | null;
  kind?: string | null;
  label?: string | null;
  title?: string | null;
  pinpoint?: string | null;
  pinpoint_label?: string | null;
  source_url?: string | null;
  markdown?: string;
}

/** Lagens JSON-form: metadata om ändringsförfattningar och strukturen (för senaste ändring per paragraf). */
interface StructuredDocument {
  uri: string;
  label?: string | null;
  title?: string | null;
  artifact?: {
    amendments?: { forarbeten?: unknown[]; properties?: Record<string, unknown> }[];
    structure?: unknown[];
  };
}

/** Ändringsförfattningen som lagtexten anger sist i paragrafen ("Lag (2021:765)."). */
export function latestAmendment(structure: unknown[] | undefined, anchor: string): string | null {
  let node: unknown = null;
  const walk = (n: unknown) => {
    if (node || !n || typeof n !== "object") return;
    const o = n as { id?: string; children?: unknown[] };
    if (o.id === anchor) {
      node = o;
      return;
    }
    o.children?.forEach(walk);
  };
  structure?.forEach(walk);
  if (!node) return null;
  const all = [...JSON.stringify(node).matchAll(/Lag \((\d{4}:\d+)\)/g)];
  return all.length ? all[all.length - 1]![1]! : null;
}

/* ─── Hämtning ────────────────────────────────────────────────────────── */

class UpstreamError extends Error {}

async function lagenGet<T>(path: string, params: Record<string, string>, ttl: number): Promise<T> {
  const url = new URL(path, LAGEN_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Cloudflare-cache: identiska uppslag går inte till lagen.nu igen inom TTL.
      cf: { cacheEverything: true, cacheTtl: ttl, cacheTtlByStatus: { "200-299": ttl, "404": 3600, "500-599": 0 } },
    } as RequestInit);
  } catch (err) {
    throw new UpstreamError(`lagen.nu svarade inte (${(err as Error).name}).`);
  }
  if (!res.ok) throw new UpstreamError(`lagen.nu svarade ${res.status}.`);
  const data = safeJson(await res.text());
  if (!data || typeof data !== "object") throw new UpstreamError("Oväntat svar från lagen.nu.");
  return data as T;
}

/* ─── Normalisering (exporteras för tester) ───────────────────────────── */

export function clean(s: string | null | undefined, max = 400): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function toResolution(query: string, data: ResolveResponse): LagenResolution {
  const hit = data.results?.[0];
  if (hit) {
    const pin = hit.pin ?? null;
    const uri = pin?.uri || hit.uri;
    return {
      query,
      status: "found",
      uri,
      url: isLagenUri(uri) ? uri : null,
      identifier: clean(hit.identifier, 120),
      title: clean(hit.title || hit.display, 300),
      kindLabel: clean(hit.kind_label, 60),
      source: hit.source ?? null,
      pinLabel: clean(pin?.label, 80),
      excerpt: clean(pin?.highlight?.[0] ?? hit.highlight?.[0], 400),
    };
  }
  const invalid = data.recognized?.find((r) => r.invalid);
  if (invalid) {
    return { ...emptyResolution(query, "invalid"), uri: invalid.uri, source: invalid.source };
  }
  return emptyResolution(query, "unknown");
}

export function emptyResolution(query: string, status: LagenResolution["status"]): LagenResolution {
  return { query, status, uri: null, url: null, identifier: null, title: null, kindLabel: null, source: null, pinLabel: null, excerpt: null };
}

function toHit(r: SearchResult): LagenSearchHit | null {
  const uri = r.pin?.uri || r.fragments?.[0]?.uri || r.uri;
  if (!isLagenUri(uri)) return null;
  const label = r.pin?.label || r.fragments?.[0]?.label;
  return {
    uri,
    url: uri,
    identifier: clean(r.identifier, 120),
    title: clean([r.title || r.display, label].filter(Boolean).join(" – "), 300),
    kindLabel: clean(r.kind_label, 60),
    excerpt: clean((r.pin?.highlight?.[0] ?? r.fragments?.[0]?.highlight?.[0] ?? r.highlight?.[0])?.replace(/<\/?[^>]+>/g, ""), 300),
  };
}

export function trimMarkdown(md: string, max = LAGEN_TEXT_MAX): { markdown: string; truncated: boolean } {
  if (md.length <= max) return { markdown: md, truncated: false };
  const cut = md.lastIndexOf("\n\n", max);
  return { markdown: md.slice(0, cut > max * 0.6 ? cut : max).trimEnd(), truncated: true };
}

function cleanQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/\s+/g, " ").trim();
  return q && q.length <= LAGEN_QUERY_MAX ? q : null;
}

export async function resolveCitation(query: string): Promise<LagenResolution> {
  try {
    return toResolution(query, await lagenGet<ResolveResponse>("/api/v1/resolve", { q: query }, TTL_RESOLVE));
  } catch (err) {
    if (err instanceof UpstreamError) return emptyResolution(query, "error");
    throw err;
  }
}

/* ─── Routes ──────────────────────────────────────────────────────────── */

const PUBLIC_CACHE = { "Cache-Control": "private, max-age=3600" };

export async function handleLagen(request: Request, url: URL): Promise<Response> {
  // Bara inloggade användare – proxyn ska inte vara öppen för vem som helst.
  if (!readSessionToken(request)) return json({ error: "Inte inloggad." }, 401);
  const route = `${request.method} ${url.pathname.replace(/\/+$/, "")}`;

  try {
    switch (route) {
      case "GET /lagen/resolve": {
        const q = cleanQuery(url.searchParams.get("q"));
        if (!q) return json({ error: "Ange en hänvisning (q)." }, 400);
        return json(await resolveCitation(q), 200, PUBLIC_CACHE);
      }
      case "POST /lagen/verify": {
        if (!isSameOriginRequest(request, url)) return json({ error: "Ogiltig förfrågan." }, 403);
        const body = safeJson(await request.text()) as { texts?: unknown } | null;
        if (!body || !Array.isArray(body.texts)) return json({ error: "Ange texts: string[]." }, 400);
        const texts = [...new Set(body.texts.map(cleanQuery).filter((t): t is string => !!t))];
        if (texts.length > LAGEN_VERIFY_MAX) return json({ error: `Högst ${LAGEN_VERIFY_MAX} hänvisningar per anrop.` }, 400);
        const results = await Promise.all(texts.map(resolveCitation));
        return json({ results }, 200, { "Cache-Control": "no-store" });
      }
      case "GET /lagen/text": {
        const uri = url.searchParams.get("uri") ?? "";
        if (!isLagenUri(uri)) return json({ error: "Ogiltig lagen.nu-adress." }, 400);
        const doc = await lagenGet<MarkdownDocument>("/api/v1/document", { uri, format: "md" }, TTL_TEXT);
        const { markdown, truncated } = trimMarkdown(doc.markdown ?? "");
        const out: LagenText = {
          uri,
          title: clean(doc.title, 300),
          identifier: clean(doc.label, 120),
          pinLabel: clean(doc.pinpoint_label, 80),
          markdown,
          truncated,
          sourceUrl: doc.source_url && /^https:\/\//.test(doc.source_url) ? doc.source_url : null,
        };
        return json(out, 200, PUBLIC_CACHE);
      }
      case "GET /lagen/doc": {
        const raw = url.searchParams.get("uri") ?? "";
        if (!isLagenUri(raw)) return json({ error: "Ogiltig lagen.nu-adress." }, 400);
        const uri = raw.split("#")[0]!;
        const doc = await lagenGet<MarkdownDocument>("/api/v1/document", { uri, format: "md" }, TTL_TEXT);
        const md = doc.markdown ?? "";
        const out: LagenDocument = {
          uri,
          title: clean(doc.title, 300),
          identifier: clean(doc.label, 120),
          kind: doc.kind ?? null,
          source: doc.source ?? null,
          ...trimMarkdown(md, LAGEN_DOC_MAX),
          sourceUrl: doc.source_url && /^https:\/\//.test(doc.source_url) ? doc.source_url : null,
        };
        return json(out, 200, PUBLIC_CACHE);
      }
      case "GET /lagen/forarbeten": {
        const raw = url.searchParams.get("uri") ?? "";
        if (!isLagenUri(raw) || !raw.includes("#")) return json({ error: "Ange en paragraf, t.ex. https://lagen.nu/2005:716#K7P18." }, 400);
        const [lawUri, anchor] = raw.split("#") as [string, string];
        const target = lagrumFromAnchor(anchor);
        if (!target) return json({ error: "Ankaret pekar inte på en paragraf." }, 400);
        const doc = await lagenGet<StructuredDocument>("/api/v1/document", { uri: lawUri }, TTL_TEXT);
        const amendments: Amendment[] = (doc.artifact?.amendments ?? []).map((a) => ({
          sfs: String(a.properties?.["dcterms:identifier"] ?? ""),
          forarbeten: Array.isArray(a.forarbeten) ? a.forarbeten.map(String) : [],
          andrar: typeof a.properties?.["rpubl:andrar"] === "string" ? (a.properties["rpubl:andrar"] as string) : null,
          ikraft: typeof a.properties?.["rpubl:ikrafttradandedatum"] === "string" ? (a.properties["rpubl:ikrafttradandedatum"] as string) : null,
        }));
        const baseSfs = doc.label ?? amendments[0]?.sfs ?? "";
        const history = provisionHistory(target, amendments, baseSfs, latestAmendment(doc.artifact?.structure, anchor)).map((e) => ({
          ...e,
          propUri: e.prop ? forarbeteUri(e.prop) : null,
        }));
        const out: ProvisionForarbeten = { lawUri, lawTitle: clean(doc.title, 300), lawSfs: doc.label?.replace(/^SFS\s*/, "") ?? null, lagrum: lagrumLabel(target), history };
        return json(out, 200, PUBLIC_CACHE);
      }
      case "GET /lagen/kommentar": {
        const prop = (url.searchParams.get("prop") ?? "").slice(0, 60);
        const propUri = forarbeteUri(prop);
        const lagrum = parseLagrumLabel(url.searchParams.get("lagrum") ?? "");
        const alt = parseLagrumLabel(url.searchParams.get("alt") ?? "");
        if (!propUri || !lagrum) return json({ error: "Ange proposition och lagrum." }, 400);
        const law = { sfs: url.searchParams.get("law")?.slice(0, 20) || null, name: url.searchParams.get("name")?.slice(0, 120) || null };
        const doc = await lagenGet<MarkdownDocument>("/api/v1/document", { uri: propUri, format: "md" }, TTL_TEXT);
        const md = doc.markdown ?? "";
        let used = lagrum;
        let found = findCommentary(md, law, lagrum);
        if (found.length === 0 && alt) {
          found = findCommentary(md, law, alt);
          used = alt;
        }
        const out: ProvisionCommentary = {
          prop,
          propUri,
          propTitle: clean(doc.title, 300),
          lagrum: found.length ? lagrumLabel(used) : null,
          found: found.slice(0, 4).map((c) => ({ ...c, markdown: c.markdown.slice(0, 40_000) })),
        };
        return json(out, 200, PUBLIC_CACHE);
      }
      case "GET /lagen/search": {
        const q = cleanQuery(url.searchParams.get("q"));
        if (!q) return json({ error: "Ange en sökfråga (q)." }, 400);
        const limit = Math.min(20, Math.max(1, Number(url.searchParams.get("limit")) || 5));
        const data = await lagenGet<SearchResponse>("/api/v1/search", { q, limit: String(limit) }, TTL_RESOLVE);
        const results = (data.results ?? []).map(toHit).filter((h): h is LagenSearchHit => !!h);
        const out: LagenSearchResult = { query: q, total: data.total ?? results.length, results };
        return json(out, 200, PUBLIC_CACHE);
      }
      default:
        return json({ error: "Okänd lagen.nu-route." }, 404);
    }
  } catch (err) {
    if (err instanceof UpstreamError) return json({ error: err.message }, 502);
    throw err;
  }
}
