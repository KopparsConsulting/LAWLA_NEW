/**
 * Förarbeten från Riksdagens öppna data (data.riksdagen.se), för arbetsytan.
 *
 *   GET /riksdagen/find?typ=prop|sou|bet|ds&bet=2004/05:170 → { dokId, title, identifier, typ }
 *   GET /riksdagen/doc?id=GS03170                            → LagenDocument (samma form som /lagen/doc)
 *
 * Bara inloggade användare, bara data.riksdagen.se, svaren cachas en vecka i Cloudflare.
 */
import type { LagenDocument } from "../shared/lagen";
import { FORARBETE_TYPER, htmlToLines, isRiksdagenId, linesToMarkdown, parseBeteckning, type ForarbeteTyp } from "../shared/riksdagen";
import { json, readSessionToken, safeJson } from "./lib";

const BASE = "https://data.riksdagen.se";
const TTL = 60 * 60 * 24 * 7;
const MAX_MARKDOWN = 3_000_000;

class UpstreamError extends Error {}

async function get(path: string, params: Record<string, string> = {}): Promise<string> {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { "User-Agent": "Lawla/2.0 (+https://lawla.kopparsconsulting.com)" },
      signal: AbortSignal.timeout(15_000),
      cf: { cacheEverything: true, cacheTtl: TTL, cacheTtlByStatus: { "200-299": TTL, "404": 3600, "500-599": 0 } },
    } as RequestInit);
  } catch (err) {
    throw new UpstreamError(`riksdagen.se svarade inte (${(err as Error).name}).`);
  }
  if (res.status === 404) throw new UpstreamError("Dokumentet finns inte hos riksdagen.se.");
  if (!res.ok) throw new UpstreamError(`riksdagen.se svarade ${res.status}.`);
  return res.text();
}

interface ListDoc {
  dok_id?: string;
  titel?: string;
  rm?: string;
  beteckning?: string;
  doktyp?: string;
  typrubrik?: string;
}

const PREFIX: Record<string, string> = Object.fromEntries(FORARBETE_TYPER.map((t) => [t.typ, t.prefix]));

export function identifierOf(d: { doktyp?: string; rm?: string; beteckning?: string }): string | null {
  if (!d.doktyp || !d.rm || !d.beteckning) return null;
  return `${PREFIX[d.doktyp] ?? d.doktyp.toUpperCase()} ${d.rm}:${d.beteckning}`;
}

export async function handleRiksdagen(request: Request, url: URL): Promise<Response> {
  if (!readSessionToken(request)) return json({ error: "Inte inloggad." }, 401);
  if (request.method !== "GET") return json({ error: "Metoden stöds inte." }, 405);
  const route = url.pathname.replace(/\/+$/, "");
  try {
    if (route === "/riksdagen/find") {
      const typ = url.searchParams.get("typ") as ForarbeteTyp | null;
      const bet = parseBeteckning(url.searchParams.get("bet") ?? "");
      if (!typ || !PREFIX[typ] || !bet) return json({ error: "Ange typ och beteckning, t.ex. 2004/05:170." }, 400);
      const text = await get("/dokumentlista/", { doktyp: typ, rm: bet.rm, bet: bet.bet, utformat: "json" });
      const data = safeJson(text) as { dokumentlista?: { dokument?: ListDoc | ListDoc[] } } | null;
      const docs = ([] as ListDoc[]).concat(data?.dokumentlista?.dokument ?? []);
      // Riksdagen kan ha flera versioner (t.ex. "GSB374" och "GSB374d2"); ta originalet.
      const doc = docs.find((d) => d.dok_id && !/d\d+$/i.test(d.dok_id)) ?? docs[0];
      if (!doc?.dok_id) return json({ error: `Hittade ingen ${PREFIX[typ]} ${bet.rm}:${bet.bet} hos riksdagen.se.` }, 404);
      return json({ dokId: doc.dok_id.toUpperCase(), title: doc.titel ?? null, identifier: identifierOf(doc), typ: doc.doktyp ?? typ }, 200, {
        "Cache-Control": "private, max-age=3600",
      });
    }
    if (route === "/riksdagen/doc") {
      const id = (url.searchParams.get("id") ?? "").toUpperCase();
      if (!isRiksdagenId(id)) return json({ error: "Ogiltigt dokument-id." }, 400);
      const [statusText, html] = await Promise.all([get(`/dokumentstatus/${id}.json`).catch(() => ""), get(`/dokument/${id}.html`)]);
      const status = safeJson(statusText) as { dokumentstatus?: { dokument?: ListDoc } } | null;
      const meta = status?.dokumentstatus?.dokument ?? {};
      const identifier = identifierOf(meta);
      const title = meta.titel ?? identifier ?? id;
      let markdown = linesToMarkdown(htmlToLines(html, identifier), title);
      const truncated = markdown.length > MAX_MARKDOWN;
      if (truncated) markdown = markdown.slice(0, MAX_MARKDOWN);
      const out: LagenDocument = {
        uri: `${BASE}/dokument/${id}`,
        title,
        identifier,
        kind: meta.doktyp ?? null,
        source: "riksdagen",
        markdown,
        truncated,
        sourceUrl: `${BASE}/dokument/${id}.html`,
      };
      return json(out, 200, { "Cache-Control": "private, max-age=3600" });
    }
    return json({ error: "Okänd riksdagen-route." }, 404);
  } catch (err) {
    if (err instanceof UpstreamError) return json({ error: err.message }, 502);
    throw err;
  }
}
