/**
 * Spårbarhet: hittar rättsliga hänvisningar i AI-genererad text (lagrum, rättsfall,
 * förarbeten) och kopplar dem till utredningens underlag, så att varje hänvisning
 * går att klicka tillbaka till rättskällan och textstället.
 *
 * Länkarna skrivs som markdown-länkar med hash-adresser (`#lawla:evidence:12`),
 * som Markdown-komponenten fångar upp och öppnar i källpanelen.
 */
import type { ExpandedEvidenceDto } from "@/api/types";

export type CitationTarget = { kind: "evidence"; evidenceId: number } | { kind: "search"; query: string };

export interface Citation {
  /** Texten som den står i analysen, t.ex. "12 kap. 3 § ÄktB". */
  text: string;
  /** Normaliserad nyckel som används för matchning. */
  key: string;
  evidenceId: number | null;
  /** Meningen i analysen där hänvisningen står (ren text, förkortad vid behov). */
  context: string;
}

export interface CitationReport {
  citations: Citation[];
  /** Underlag som analysen hänvisar till. */
  used: ExpandedEvidenceDto[];
  /** Underlag som inte hänvisas till alls. */
  unused: ExpandedEvidenceDto[];
  /** Hänvisningar i texten som inte finns i underlaget (unika, i textordning). */
  unmatched: string[];
}

/* ─── Normalisering ─────────────────────────────────────────────────── */

/** Vanliga förkortningar av lagar → ord som ingår i lagens titel. */
const LAW_ABBREVIATIONS: Record<string, string> = {
  äktb: "äktenskapsbalk",
  fb: "föräldrabalk",
  äb: "ärvdabalk",
  jb: "jordabalk",
  brb: "brottsbalk",
  rb: "rättegångsbalk",
  hb: "handelsbalk",
  mb: "miljöbalk",
  ub: "utsökningsbalk",
  sb: "sambolag",
  avtl: "avtal",
  köpl: "köplag",
  kkl: "konsumentköplag",
  ktjl: "konsumenttjänstlag",
  skl: "skadeståndslag",
  abl: "aktiebolagslag",
  bfl: "bokföringslag",
  las: "anställningsskydd",
  mbl: "medbestämmande",
  dl: "diskrimineringslag",
  seml: "semesterlag",
  atl: "arbetstidslag",
  aml: "arbetsmiljölag",
  sol: "socialtjänstlag",
  lss: "stöd och service",
  il: "inkomstskattelag",
  ml: "mervärdesskattelag",
  sfl: "skatteförfarandelag",
  osl: "offentlighets- och sekretesslag",
  fl: "förvaltningslag",
  fpl: "förvaltningsprocesslag",
  pbl: "plan- och bygglag",
  rf: "regeringsform",
  tf: "tryckfrihetsförordning",
  ygl: "yttrandefrihetsgrundlag",
  url: "upphovsrätt",
  vml: "varumärkeslag",
  pl: "patentlag",
  fal: "försäkringsavtalslag",
  konkl: "konkurslag",
  kl: "konkurslag",
  lul: "unga lagöverträdare",
  lvu: "vård av unga",
  lvm: "vård av missbrukare",
  lpt: "psykiatrisk tvångsvård",
  utll: "utlänningslag",
  hsl: "hälso- och sjukvårdslag",
  psl: "patientsäkerhetslag",
  gdpr: "dataskyddsförordning",
  ebl: "ekonomiska föreningar",
  brl: "bostadsrättslag",
  hyresl: "hyreslag",
};

export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tar fram ett "lag-ord" ur en förkortning eller ett lagnamn, t.ex. "ÄktB" → "äktenskapsbalk". */
export function lawWord(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const token = raw.replace(/[()]/g, "").trim();
  if (!token) return null;
  const lower = token.toLowerCase();
  if (LAW_ABBREVIATIONS[lower]) return LAW_ABBREVIATIONS[lower]!;
  // "äktenskapsbalken" → "äktenskapsbalk", "avtalslagen" → "avtalslag"
  const m = lower.match(/^([a-zåäö-]+?)(en|n)?$/);
  if (m && m[1]!.length >= 5) return m[1]!;
  return null;
}

/* ─── Mönster ───────────────────────────────────────────────────────── */

// Avsnitt med "kap.": "12 kap. 3 § ÄktB", "3 kap. 1 a § FB", "4 kap. 1 § jordabalken"
const LAGRUM_KAP = /\b(\d{1,3})\s*kap\.?\s*(\d{1,3}(?:\s?[a-z])?)\s*§§?(?:\s+(?:i\s+)?([A-ZÅÄÖ][A-Za-zÅÄÖåäö]*[A-ZÅÄÖ][A-Za-zÅÄÖåäö]*|[a-zåäö]+(?:lagen|balken|förordningen)))?/g;
// Paragraf utan kapitel: "36 § AvtL", "6 § avtalslagen", "36 § lagen"
// (Kapitelformen ovan söks först; överlappande träffar hoppas över.)
const LAGRUM_PAR = /\b(\d{1,3}(?:\s?[a-z])?)\s*§§?\s+(?:i\s+)?([A-ZÅÄÖ][A-Za-zÅÄÖåäö]*[A-ZÅÄÖ][A-Za-zÅÄÖåäö]*|[a-zåäö]+(?:lagen|balken|förordningen))\b/g;
// Praxis och förarbeten
const CASE_PATTERNS: RegExp[] = [
  /\bNJA\s+\d{4}\s+s\.?\s*\d+(?:\s*[A-Z]\b)?/g,
  /\bNJA\s+\d{4}\s+not\.?\s*\d+/g,
  /\bRH\s+\d{4}:\d+/g,
  /\b(?:HFD|RÅ)\s+\d{4}\s+(?:ref\.?|not\.?)\s*\d+/g,
  /\bHFD\s+\d{4}:\d+/g,
  /\bAD\s+\d{4}\s+nr\s+\d+/g,
  /\bMÖD\s+\d{4}:\d+/g,
  /\bMD\s+\d{4}:\d+/g,
  /\bprop\.?\s+\d{4}(?:\/\d{2,4})?:\d+/gi,
  /\bSOU\s+\d{4}:\d+/g,
  /\bDs\s+\d{4}:\d+/g,
  /\bbet\.?\s+\d{4}\/\d{2}:[A-Za-z]+\d+/g,
  /\bC-\d+\/\d+/g,
];

/* ─── Nycklar för underlaget ────────────────────────────────────────── */

interface EvidenceIndex {
  byKey: Map<string, number[]>;
  /** Lagrum utan känd lag: "kap:par" → evidence-id. Används bara om träffen är entydig. */
  byLagrumLoose: Map<string, number[]>;
  byLabel: Map<string, number>;
}

function push(map: Map<string, number[]>, key: string, id: number) {
  const list = map.get(key) ?? [];
  if (!list.includes(id)) list.push(id);
  map.set(key, list);
}

function lagrumKey(law: string | null, kap: string | null, par: string): string {
  return `lagrum:${law ?? "*"}:${kap ?? "-"}:${normalizeKey(par).replace(/\s/g, "")}`;
}

/** Lagrumsreferenser ur en etikett som "Äktenskapsbalk (1987:230) – 12 kap. 3 §". */
function lagrumsFromLabel(label: string): { kap: string | null; par: string }[] {
  const out: { kap: string | null; par: string }[] = [];
  for (const m of label.matchAll(/(?:(\d{1,3})\s*kap\.?\s*)?(\d{1,3}(?:\s?[a-z])?)\s*§/gi)) {
    out.push({ kap: m[1] ?? null, par: m[2]! });
  }
  return out;
}

function lawWordFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const lower = title.toLowerCase();
  for (const word of Object.values(LAW_ABBREVIATIONS)) if (lower.includes(word)) return word;
  const m = lower.match(/([a-zåäö-]+(?:lag|balk|förordning))(?:en)?\b/);
  return m ? m[1]! : null;
}

export function indexEvidence(evidence: ExpandedEvidenceDto[]): EvidenceIndex {
  const index: EvidenceIndex = { byKey: new Map(), byLagrumLoose: new Map(), byLabel: new Map() };
  for (const e of evidence) {
    const texts = [e.displayLabel, e.documentTitle].filter((t): t is string => !!t);
    const law = lawWordFromTitle(e.documentTitle) ?? lawWordFromTitle(e.displayLabel);

    // Praxis/förarbeten i etikett eller titel
    for (const t of texts) {
      for (const pattern of CASE_PATTERNS) {
        for (const m of t.matchAll(pattern)) push(index.byKey, normalizeKey(m[0]), e.id);
      }
      if (t.length >= 6) index.byLabel.set(normalizeKey(t), e.id);
    }

    // Lagrum ur etikett och strukturfält
    const refs = lagrumsFromLabel(e.displayLabel ?? "");
    if (e.paragraph) {
      const par = e.paragraph.replace(/§/g, "").trim();
      const kap = e.chapter?.replace(/kap\.?/i, "").trim() || null;
      if (par) refs.push({ kap, par });
    }
    for (const r of refs) {
      push(index.byKey, lagrumKey(law, r.kap, r.par), e.id);
      push(index.byLagrumLoose, lagrumKey(null, r.kap, r.par), e.id);
    }
  }
  return index;
}

/* ─── Hitta hänvisningar i text ─────────────────────────────────────── */

interface Found {
  start: number;
  end: number;
  text: string;
  key: string;
  looseKey: string | null;
}

function findInSegment(text: string): Found[] {
  const found: Found[] = [];
  const taken: [number, number][] = [];
  const overlaps = (s: number, e: number) => taken.some(([a, b]) => s < b && e > a);
  const add = (m: RegExpMatchArray, key: string, looseKey: string | null) => {
    const start = m.index!;
    const end = start + m[0].length;
    if (overlaps(start, end)) return;
    taken.push([start, end]);
    found.push({ start, end, text: m[0], key, looseKey });
  };

  for (const pattern of CASE_PATTERNS) {
    for (const m of text.matchAll(pattern)) add(m, normalizeKey(m[0]), null);
  }
  for (const m of text.matchAll(LAGRUM_KAP)) {
    const law = lawWord(m[3]);
    add(m, lagrumKey(law, m[1]!, m[2]!), lagrumKey(null, m[1]!, m[2]!));
  }
  for (const m of text.matchAll(LAGRUM_PAR)) {
    const law = lawWord(m[2]);
    add(m, lagrumKey(law, null, m[1]!), lagrumKey(null, null, m[1]!));
  }
  return found.sort((a, b) => a.start - b.start);
}

function resolve(f: Found, index: EvidenceIndex): number | null {
  const exact = index.byKey.get(f.key);
  if (exact?.length) return exact[0]!;
  if (f.looseKey) {
    if (f.key.startsWith("lagrum:*:")) {
      // Lagen saknas eller känns inte igen i texten: godta bara om underlaget har exakt en kandidat.
      const loose = index.byLagrumLoose.get(f.looseKey);
      if (loose?.length === 1) return loose[0]!;
    } else {
      // Texten anger lag, men underlagets lag gick inte att avgöra: godta en entydig sådan kandidat.
      const unknownLaw = index.byKey.get(f.looseKey);
      if (unknownLaw?.length === 1) return unknownLaw[0]!;
    }
  }
  return index.byLabel.get(normalizeKey(f.text)) ?? null;
}

/** Delar upp markdown i segment som får länkas respektive lämnas orörda (kod, befintliga länkar, rubrikrader). */
function segments(markdown: string): { text: string; protect: boolean }[] {
  const out: { text: string; protect: boolean }[] = [];
  const re = /```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]*\]\([^)\n]*\)|<[^>\n]+>/g;
  let last = 0;
  for (const m of markdown.matchAll(re)) {
    if (m.index! > last) out.push({ text: markdown.slice(last, m.index), protect: false });
    out.push({ text: m[0], protect: true });
    last = m.index! + m[0].length;
  }
  if (last < markdown.length) out.push({ text: markdown.slice(last), protect: false });
  return out;
}

export function citationHref(target: CitationTarget): string {
  return target.kind === "evidence" ? `#lawla:evidence:${target.evidenceId}` : `#lawla:search:${encodeURIComponent(target.query)}`;
}

export function parseCitationHref(href: string | undefined): CitationTarget | null {
  if (!href?.startsWith("#lawla:")) return null;
  const [, kind, ...rest] = href.slice(1).split(":");
  const value = rest.join(":");
  if (kind === "evidence" && /^\d+$/.test(value)) return { kind: "evidence", evidenceId: Number(value) };
  if (kind === "search") return { kind: "search", query: decodeURIComponent(value) };
  return null;
}

/** Tar bort markdown-syntax så att ett utdrag kan visas som ren text. */
export function plainText(md: string): string {
  return md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, "$2")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Meningen runt ett textställe: stycket/raden avgränsas av radbrytningar, meningen av
 * punkt, utrops- eller frågetecken följt av versal (så att "12 kap. 3 §" och "s. 583" hålls ihop).
 */
export function sentenceAround(text: string, start: number, end: number, max = 260): string {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const nl = text.indexOf("\n", end);
  const lineEnd = nl === -1 ? text.length : nl;
  const line = text.slice(lineStart, lineEnd);
  const s = start - lineStart;
  const e = end - lineStart;
  let from = 0;
  let to = line.length;
  for (const m of line.matchAll(/[.!?](?:\*\*|\*|_)?\s+(?=[*_]*[A-ZÅÄÖ])/g)) {
    const cut = m.index! + m[0].length;
    if (cut <= s) from = cut;
    else if (m.index! >= e) {
      to = m.index! + 1;
      break;
    }
  }
  let out = plainText(line.slice(from, to));
  if (out.length > max) {
    const mid = plainText(line.slice(from, s)).length;
    const a = Math.max(0, Math.min(out.length - max, mid - Math.floor(max / 3)));
    out = `${a > 0 ? "…" : ""}${out.slice(a, a + max).trim()}${a + max < out.length ? "…" : ""}`;
  }
  return out;
}

/** Analyserar texten och återger den med klickbara hänvisningar. */
export function linkifyCitations(markdown: string, evidence: ExpandedEvidenceDto[]): { markdown: string; report: CitationReport } {
  const index = indexEvidence(evidence);
  const citations: Citation[] = [];
  const parts: string[] = [];

  let base = 0;
  for (const seg of segments(markdown)) {
    const segStart = base;
    base += seg.text.length;
    if (seg.protect) {
      parts.push(seg.text);
      continue;
    }
    let cursor = 0;
    for (const f of findInSegment(seg.text)) {
      const evidenceId = resolve(f, index);
      citations.push({ text: f.text, key: f.key, evidenceId, context: sentenceAround(markdown, segStart + f.start, segStart + f.end) });
      const target: CitationTarget = evidenceId != null ? { kind: "evidence", evidenceId } : { kind: "search", query: f.text };
      parts.push(seg.text.slice(cursor, f.start), `[${f.text}](${citationHref(target)})`);
      cursor = f.end;
    }
    parts.push(seg.text.slice(cursor));
  }

  const usedIds = new Set(citations.map((c) => c.evidenceId).filter((id): id is number => id != null));
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const c of citations) {
    if (c.evidenceId != null || seen.has(c.key)) continue;
    seen.add(c.key);
    unmatched.push(c.text);
  }
  return {
    markdown: parts.join(""),
    report: {
      citations,
      used: evidence.filter((e) => usedIds.has(e.id)),
      unused: evidence.filter((e) => !usedIds.has(e.id)),
      unmatched,
    },
  };
}
