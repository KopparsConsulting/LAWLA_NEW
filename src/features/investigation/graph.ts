/**
 * Relationsgraf för rättskällor: visar hur rättsfrågorna, rättskällorna i underlaget och
 * den samlade analysen hänger ihop – och vilka hänvisningar som inte finns i underlaget.
 *
 * Kanterna härleds helt i klienten:
 *  - rättsfråga → rättskälla: delanalysen hänvisar till källan (via `linkifyCitations`)
 *  - samlad analys → rättskälla: den samlade analysen hänvisar till källan
 *  - rättskälla → rättskälla: källornas dokument hänvisar till varandra (backendens referenser)
 *  - rättsfråga/analys → saknad hänvisning: hänvisning som inte finns i underlaget
 *  - rättskälla → föreslagen källa: källans dokument hänvisar till ett dokument som inte finns i underlaget
 *
 * Här finns också kvalitetskontrollen per rättsfråga (`assessGraph`) och täckningsmatrisen
 * (`buildMatrix`), som både vyn och rapporten använder.
 *
 * Layouten är en deterministisk lagerlayout i tre kolumner (inget grafbibliotek).
 */
import type { DocumentReferenceDto, ExpandedEvidenceDto, LegalIssueAnalysisDto, ProjectAnalysisDto, ProjectDetailDto } from "@/api/types";
import { linkifyCitations, normalizeKey } from "./citations";

export type SourceKind = "lagrum" | "praxis" | "forarbeten" | "doktrin" | "ovrigt";
export type NodeKind = "issue" | "analysis" | "source" | "missing" | "suggested";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Kort beteckning: "F1", "F2" … för rättsfrågor, "Samlad" för den samlade analysen. */
  short?: string;
  /** Underrubrik, t.ex. dokumenttitel. */
  sub?: string;
  /** Typ av rättskälla (bara för kind = "source"). */
  sourceKind?: SourceKind;
  /** Rättsfrågans id / rättskällans id / analysens id. */
  refId?: number;
  /** Dokumentet bakom noden. För saknade hänvisningar: ett dokument i korpusen som verkar motsvara hänvisningen. */
  documentId?: number | null;
  /** Antal hänvisningar som pekar på noden (för föreslagna källor: antal källdokument som hänvisar dit). */
  weight: number;
}

export type EdgeKind = "cites" | "refers";

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** Antal hänvisningar (cites) eller antal dokumentreferenser (refers). */
  weight: number;
  /** Kort beskrivning för tooltip. */
  title?: string;
  /** Meningarna i analysen där hänvisningen står (unika, i textordning). Bara för cites. */
  contexts: string[];
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  lagrum: "Lagrum",
  praxis: "Praxis",
  forarbeten: "Förarbeten",
  doktrin: "Doktrin",
  ovrigt: "Övrigt",
};

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  issue: "Rättsfråga",
  analysis: "Samlad analys",
  source: "Rättskälla",
  missing: "Saknas i underlaget",
  suggested: "Föreslagen källa",
};

/** Hur många föreslagna källor som högst visas (de som flest källor hänvisar till). */
export const MAX_SUGGESTED = 12;

const PRAXIS_RE = /\b(NJA|RH|HFD|RÅ|AD|MÖD|MD)\s+\d{4}|\bC-\d+\/\d+/;
const FORARBETEN_RE = /\b(prop\.?|SOU|Ds|bet\.?)\s+\d{4}/i;
const LAGRUM_RE = /\d\s*§|\bkap\.?\s*\d|(lag|balk|förordning)(en)?\b|\(\d{4}:\d+\)/i;
const DOKTRIN_RE = /\b(doktrin|kommentar|handbok|lärobok|artikel|JT\b|SvJT|uppsats)/i;

/** Avgör typ av rättskälla utifrån dokumenttyp, etikett och titel. */
export function classifySource(e: Pick<ExpandedEvidenceDto, "displayLabel" | "documentTitle"> & { documentType?: string | null }): SourceKind {
  const type = (e.documentType ?? "").toLowerCase();
  if (type) {
    if (/praxis|rättsfall|dom|case|avgörande/.test(type)) return "praxis";
    if (/förarbete|prop|sou|ds|forarbete/.test(type)) return "forarbeten";
    if (/lag|författning|balk|förordning|statute|sfs/.test(type)) return "lagrum";
    if (/doktrin|litteratur|kommentar|artikel/.test(type)) return "doktrin";
  }
  const text = `${e.displayLabel ?? ""} ${e.documentTitle ?? ""}`;
  if (PRAXIS_RE.test(text)) return "praxis";
  if (FORARBETEN_RE.test(text)) return "forarbeten";
  if (DOKTRIN_RE.test(text)) return "doktrin";
  if (LAGRUM_RE.test(text)) return "lagrum";
  return "ovrigt";
}

export const issueNodeId = (id: number) => `issue:${id}`;
export const sourceNodeId = (id: number) => `source:${id}`;
export const missingNodeId = (text: string) => `missing:${normalizeKey(text)}`;
export const suggestedNodeId = (documentId: number) => `suggested:${documentId}`;
export const citeEdgeId = (from: string, to: string) => `cites:${from}>${to}`;
export const ANALYSIS_NODE_ID = "analysis";

export interface GraphInput {
  project: ProjectDetailDto;
  evidence: ExpandedEvidenceDto[];
  /** Senaste delanalys per rättsfråga. */
  issueAnalyses: Map<number, LegalIssueAnalysisDto>;
  /** Senaste samlade analys, om någon. */
  analysis?: ProjectAnalysisDto | null;
  /** Utgående dokumentreferenser per dokument-id (för rättskällornas dokument). */
  references?: Map<number, DocumentReferenceDto[]>;
  /** Dokumenttyp per dokument-id, om känd. */
  documentTypes?: Map<number, string | null>;
}

function trimLabel(s: string, max = 60): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function sortedIssues(project: ProjectDetailDto) {
  return [...(project.legalIssues ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

export function buildGraph(input: GraphInput): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const addEdge = (from: string, to: string, kind: EdgeKind, title?: string, context?: string) => {
    const id = kind === "cites" ? citeEdgeId(from, to) : `${kind}:${from}>${to}`;
    let edge = edges.get(id);
    if (edge) edge.weight += 1;
    else {
      edge = { id, from, to, kind, weight: 1, title, contexts: [] };
      edges.set(id, edge);
    }
    if (context && !edge.contexts.includes(context)) edge.contexts.push(context);
  };
  const bump = (id: string) => {
    const n = nodes.get(id);
    if (n) n.weight += 1;
  };

  // Rättskällor
  for (const e of input.evidence) {
    const documentType = e.documentId != null ? input.documentTypes?.get(e.documentId) : null;
    nodes.set(sourceNodeId(e.id), {
      id: sourceNodeId(e.id),
      kind: "source",
      label: trimLabel(e.displayLabel || e.documentTitle || `Källa ${e.id}`, 160),
      sub: e.documentTitle && e.displayLabel ? trimLabel(e.documentTitle, 80) : undefined,
      sourceKind: classifySource({ ...e, documentType }),
      refId: e.id,
      documentId: e.documentId,
      weight: 0,
    });
  }

  // Rättsfrågor + delanalysernas hänvisningar
  sortedIssues(input.project).forEach((issue, i) => {
    const id = issueNodeId(issue.id);
    nodes.set(id, { id, kind: "issue", label: trimLabel(issue.text || `Rättsfråga ${i + 1}`, 400), short: `F${i + 1}`, refId: issue.id, weight: 0 });
    const analysis = input.issueAnalyses.get(issue.id);
    if (!analysis?.outputContent) return;
    linkCitations(id, `Rättsfråga ${i + 1}`, analysis.outputContent);
  });

  // Samlad analys
  if (input.analysis?.outputContent) {
    nodes.set(ANALYSIS_NODE_ID, { id: ANALYSIS_NODE_ID, kind: "analysis", label: "Samlad analys", short: "Samlad", refId: input.analysis.id, weight: 0 });
    linkCitations(ANALYSIS_NODE_ID, "Samlad analys", input.analysis.outputContent);
  }

  function linkCitations(fromId: string, fromLabel: string, markdown: string) {
    const { report } = linkifyCitations(markdown, input.evidence);
    for (const c of report.citations) {
      if (c.evidenceId != null) {
        const to = sourceNodeId(c.evidenceId);
        if (!nodes.has(to)) continue;
        addEdge(fromId, to, "cites", `${fromLabel} hänvisar till ${c.text}`, c.context);
        bump(to);
      } else {
        const to = missingNodeId(c.text);
        if (!nodes.has(to)) nodes.set(to, { id: to, kind: "missing", label: trimLabel(c.text), weight: 0 });
        addEdge(fromId, to, "cites", `${fromLabel} hänvisar till ${c.text}, som saknas i underlaget`, c.context);
        bump(to);
      }
    }
  }

  // Dokumentreferenser från rättskällornas dokument
  if (input.references) {
    const byDoc = new Map<number, string[]>();
    for (const e of input.evidence) {
      if (e.documentId == null) continue;
      const list = byDoc.get(e.documentId) ?? [];
      list.push(sourceNodeId(e.id));
      byDoc.set(e.documentId, list);
    }
    // Saknade hänvisningar, för att känna igen när ett källdokument hänvisar till samma sak.
    const missingByKey = new Map<string, GraphNode>();
    for (const n of nodes.values()) if (n.kind === "missing") missingByKey.set(normalizeKey(n.label), n);
    const matchMissing = (r: DocumentReferenceDto): GraphNode | undefined => {
      for (const t of [r.canonicalForm, r.citationText, r.displayText]) {
        const hit = t ? missingByKey.get(normalizeKey(t)) : undefined;
        if (hit) return hit;
      }
      return undefined;
    };

    const suggested = new Map<number, { title: string; from: Set<string>; via: string[] }>();
    for (const [docId, refs] of [...input.references].sort((a, b) => a[0] - b[0])) {
      const fromNodes = byDoc.get(docId);
      if (!fromNodes) continue;
      const from = fromNodes[0]!;
      const seenTargets = new Set<number>();
      for (const r of refs) {
        if (!r.isResolved || r.targetDocumentId == null || r.targetDocumentId === docId) continue;
        const target = r.targetDocumentId;
        if (seenTargets.has(target)) continue;
        seenTargets.add(target);
        const text = r.displayText || r.citationText || r.canonicalForm || "Hänvisning";
        const toNodes = byDoc.get(target);
        if (toNodes) {
          // Koppla ett representativt par per dokumentpar så grafen inte drunknar i kanter.
          addEdge(from, toNodes[0]!, "refers", `${text} → ${r.targetDocumentTitle ?? ""}`.trim());
          continue;
        }
        const missing = matchMissing(r);
        if (missing) {
          // Analysen hänvisar till något som saknas – men det finns i korpusen och källorna hänvisar dit.
          missing.documentId ??= target;
          missing.sub ??= r.targetDocumentTitle ? trimLabel(r.targetDocumentTitle, 80) : undefined;
          addEdge(from, missing.id, "refers", `${text} → ${r.targetDocumentTitle ?? ""}`.trim());
          continue;
        }
        const s = suggested.get(target) ?? { title: r.targetDocumentTitle || text, from: new Set<string>(), via: [] };
        s.from.add(from);
        if (!s.via.includes(text)) s.via.push(text);
        suggested.set(target, s);
      }
    }
    const top = [...suggested.entries()]
      .sort((a, b) => b[1].from.size - a[1].from.size || a[1].title.localeCompare(b[1].title, "sv") || a[0] - b[0])
      .slice(0, MAX_SUGGESTED);
    for (const [docId, s] of top) {
      const id = suggestedNodeId(docId);
      nodes.set(id, { id, kind: "suggested", label: trimLabel(s.title, 160), sub: s.via.slice(0, 3).join(", "), documentId: docId, weight: s.from.size });
      for (const from of s.from) addEdge(from, id, "refers", `Hänvisar till ${s.title}, som inte finns i underlaget`);
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/* ─── Kvalitetskontroll ─────────────────────────────────────────────── */

export type WarningLevel = "danger" | "warn" | "info";

export interface Warning {
  level: WarningLevel;
  code: "no-analysis" | "no-citations" | "missing" | "single-source" | "weak-sources" | "no-lagrum" | "no-praxis" | "stale";
  text: string;
}

const LEVEL_RANK: Record<WarningLevel, number> = { danger: 0, warn: 1, info: 2 };

export function worstLevel(warnings: Warning[] | undefined): WarningLevel | null {
  if (!warnings?.length) return null;
  return [...warnings].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level])[0]!.level;
}

const time = (s: string | null | undefined) => {
  const t = s ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Bedömer hur väl varje rättsfråga (och den samlade analysen) är förankrad i underlaget.
 * Nyckel: nodens id. Varningarna är sorterade med de allvarligaste först.
 */
export function assessGraph(graph: Graph, input: Pick<GraphInput, "project" | "issueAnalyses" | "analysis">): Map<string, Warning[]> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const evidenceTimes = (input.project.evidence ?? []).map((e) => time(e.createdAt)).filter((t): t is number => t != null);
  const out = new Map<string, Warning[]>();

  const assessCitations = (nodeId: string, warnings: Warning[]) => {
    const targets = graph.edges.filter((e) => e.kind === "cites" && e.from === nodeId).map((e) => byId.get(e.to)).filter((n): n is GraphNode => !!n);
    const sources = targets.filter((n) => n.kind === "source");
    const missing = targets.filter((n) => n.kind === "missing");
    if (missing.length > 0)
      warnings.push({
        level: "danger",
        code: "missing",
        text: `${plural(missing.length, "hänvisning", "hänvisningar")} saknas i underlaget: ${missing.map((m) => m.label).join(", ")}.`,
      });
    if (sources.length === 0) {
      if (missing.length === 0) warnings.push({ level: "warn", code: "no-citations", text: "Analysen hänvisar inte till något i underlaget." });
      return;
    }
    if (sources.length === 1) warnings.push({ level: "warn", code: "single-source", text: "Vilar på en enda rättskälla." });
    const kinds = new Set(sources.map((s) => s.sourceKind ?? "ovrigt"));
    if ([...kinds].every((k) => k === "doktrin" || k === "ovrigt"))
      warnings.push({ level: "warn", code: "weak-sources", text: "Stöds bara av doktrin eller övriga källor – inget lagrum, ingen praxis och inga förarbeten." });
    else if (!kinds.has("lagrum")) warnings.push({ level: "warn", code: "no-lagrum", text: "Inget lagrum i underlaget stöder analysen." });
    if (!kinds.has("praxis") && !warnings.some((w) => w.code === "weak-sources"))
      warnings.push({ level: "info", code: "no-praxis", text: "Ingen praxis i underlaget för frågan." });
  };

  const staleness = (createdAt: string, extra: number[] = []): Warning | null => {
    const at = time(createdAt);
    if (at == null) return null;
    const newer = evidenceTimes.filter((t) => t > at).length;
    const newerAnalyses = extra.filter((t) => t > at).length;
    if (newer === 0 && newerAnalyses === 0) return null;
    const parts = [
      newer > 0 ? `${plural(newer, "rättskälla", "rättskällor")} har lagts till` : null,
      newerAnalyses > 0 ? `${plural(newerAnalyses, "delanalys", "delanalyser")} har körts om` : null,
    ].filter(Boolean);
    return { level: "warn", code: "stale", text: `${parts.join(" och ")} sedan analysen gjordes – kör om den.` };
  };

  for (const issue of sortedIssues(input.project)) {
    const id = issueNodeId(issue.id);
    if (!byId.has(id)) continue;
    const warnings: Warning[] = [];
    const analysis = input.issueAnalyses.get(issue.id);
    if (!analysis?.outputContent) warnings.push({ level: "info", code: "no-analysis", text: "Ingen delanalys har körts." });
    else {
      assessCitations(id, warnings);
      const stale = staleness(analysis.createdAt);
      if (stale) warnings.push(stale);
    }
    out.set(id, warnings.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]));
  }

  if (input.analysis?.outputContent && byId.has(ANALYSIS_NODE_ID)) {
    const warnings: Warning[] = [];
    assessCitations(ANALYSIS_NODE_ID, warnings);
    const issueTimes = [...input.issueAnalyses.values()].map((a) => time(a.createdAt)).filter((t): t is number => t != null);
    const stale = staleness(input.analysis.createdAt, issueTimes);
    if (stale) warnings.push(stale);
    out.set(ANALYSIS_NODE_ID, warnings.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]));
  }
  return out;
}

/* ─── Täckningsmatris ───────────────────────────────────────────────── */

export interface MatrixRow {
  node: GraphNode;
  /** Antal hänvisningar per kolumn (samma ordning som `columns`). */
  cells: number[];
  total: number;
}

export interface Matrix {
  /** Rättsfrågorna i ordning, sist den samlade analysen om den finns. */
  columns: GraphNode[];
  /** Rättskällor som minst en analys hänvisar till, ordnade efter typ och antal hänvisningar. */
  rows: MatrixRow[];
  /** Hänvisningar som saknas i underlaget. */
  missing: MatrixRow[];
  /** Rättskällor som ingen analys hänvisar till. */
  unused: GraphNode[];
}

const SOURCE_KIND_ORDER: SourceKind[] = ["lagrum", "forarbeten", "praxis", "doktrin", "ovrigt"];

export function buildMatrix(graph: Graph): Matrix {
  const columns = [...graph.nodes.filter((n) => n.kind === "issue"), ...graph.nodes.filter((n) => n.kind === "analysis")];
  const counts = new Map<string, number>();
  for (const e of graph.edges) if (e.kind === "cites") counts.set(`${e.from}>${e.to}`, e.weight);
  const row = (node: GraphNode): MatrixRow => {
    const cells = columns.map((c) => counts.get(`${c.id}>${node.id}`) ?? 0);
    return { node, cells, total: cells.reduce((s, n) => s + n, 0) };
  };
  const kindRank = (n: GraphNode) => SOURCE_KIND_ORDER.indexOf(n.sourceKind ?? "ovrigt");
  const byTotal = (a: MatrixRow, b: MatrixRow) => b.total - a.total || a.node.label.localeCompare(b.node.label, "sv");
  const sources = graph.nodes.filter((n) => n.kind === "source").map(row);
  return {
    columns,
    rows: sources.filter((r) => r.total > 0).sort((a, b) => kindRank(a.node) - kindRank(b.node) || byTotal(a, b)),
    missing: graph.nodes.filter((n) => n.kind === "missing").map(row).sort(byTotal),
    unused: sources.filter((r) => r.total === 0).map((r) => r.node).sort((a, b) => kindRank(a) - kindRank(b) || a.label.localeCompare(b.label, "sv")),
  };
}

/* ─── Fokus och filter ──────────────────────────────────────────────── */

/**
 * Delgraf kring en nod: noden, dess grannar och – för rättsfrågor och analysen – korsreferenser
 * och föreslagna källor från de källor den bygger på.
 */
export function focusGraph(graph: Graph, id: string): Graph {
  const keep = neighbours(graph, id);
  const center = graph.nodes.find((n) => n.id === id);
  if (center && (center.kind === "issue" || center.kind === "analysis")) {
    const sources = new Set([...keep].filter((k) => k.startsWith("source:")));
    for (const e of graph.edges) if (e.kind === "refers" && sources.has(e.from)) keep.add(e.to);
  }
  const nodes = graph.nodes.filter((n) => keep.has(n.id));
  const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to) && (e.kind === "refers" || e.from === id || e.to === id));
  return { nodes, edges };
}

/* ─── Layout ────────────────────────────────────────────────────────── */

export interface Positioned extends GraphNode {
  x: number;
  y: number;
  r: number;
  /** Hur många tecken etiketten får ta innan den kortas. */
  labelChars: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
}

export function nodeRadius(n: GraphNode): number {
  if (n.kind === "issue") return 18;
  if (n.kind === "analysis") return 22;
  if (n.kind === "missing" || n.kind === "suggested") return 9;
  return 10 + Math.min(10, n.weight * 2);
}

/** Minsta lodräta avstånd mellan nodcentrum i en kolumn (ger plats för etiketter). */
export const ROW_GAP = 46;
/** Ungefärlig bredd per tecken i etiketterna (12 px Inter). */
const CHAR_W = 6.4;

/** Kolumn per nodtyp: frågor/analys till vänster, källor i mitten, det som ligger utanför underlaget till höger. */
function column(n: GraphNode): 0 | 1 | 2 {
  if (n.kind === "issue" || n.kind === "analysis") return 0;
  if (n.kind === "source") return 1;
  return 2;
}

/** Antal rader i den fullaste kolumnen – används för att välja höjd på ytan. */
export function layoutRows(graph: Graph): number {
  const counts = [0, 0, 0];
  for (const n of graph.nodes) counts[column(n)]! += 1;
  return Math.max(1, ...counts);
}

/** Höjd som ryms utan att noderna överlappar. */
export function layoutHeight(graph: Graph): number {
  return Math.max(420, 80 + layoutRows(graph) * ROW_GAP);
}

/**
 * Lagerlayout i tre kolumner. Noderna i kolumn 1 och 2 sorteras efter tyngdpunkten hos de
 * noder som hänvisar till dem (barycenter), så att kanterna korsar varandra så lite som möjligt.
 * Deterministisk: samma graf och yta ger alltid samma bild. Höjden bör vara minst `layoutHeight`.
 */
export function layoutGraph(graph: Graph, opts: LayoutOptions): Positioned[] {
  const { width } = opts;
  const height = Math.max(opts.height, layoutHeight(graph));
  const nodes: Positioned[] = graph.nodes.map((n) => ({ ...n, x: 0, y: 0, r: nodeRadius(n), labelChars: 34 }));
  if (nodes.length === 0) return nodes;
  if (nodes.length === 1) {
    nodes[0]!.x = width / 2;
    nodes[0]!.y = opts.height / 2;
    nodes[0]!.labelChars = Math.max(8, Math.floor((width / 2 - 40) / CHAR_W));
    return nodes;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hasLeft = nodes.some((n) => column(n) === 0);
  const hasRight = nodes.some((n) => column(n) === 2);
  // Kolumnernas x: utan högerkolumn får källornas etiketter resten av bredden.
  const leftX = hasLeft ? Math.min(300, Math.max(96, width * 0.34)) : 0;
  const rightX = width - Math.min(150, Math.max(70, width * 0.2));
  const midX = hasLeft ? (hasRight ? leftX + (rightX - leftX) * 0.28 : Math.max(leftX + 70, width * 0.45)) : hasRight ? width * 0.15 : width * 0.2;
  const columnX = [leftX, midX, rightX];
  const labelSpace = [leftX - 30, (hasRight ? rightX - 24 : width - 8) - midX - 24, width - rightX - 20];

  // Kolumn 0: rättsfrågor i sin ordning, samlad analys sist.
  const left = nodes.filter((n) => column(n) === 0).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "analysis" ? 1 : -1));
  place(left, 0);

  const kindRank = (n: Positioned) => (n.sourceKind ? SOURCE_KIND_ORDER.indexOf(n.sourceKind) : n.kind === "missing" ? 0 : 1);
  const compareBy = (bary: (n: Positioned) => number) => (a: Positioned, b: Positioned) => {
    const ba = bary(a);
    const bb = bary(b);
    if (ba !== bb) return ba - bb; // oanvända (Infinity) hamnar sist
    if (!Number.isFinite(ba) && kindRank(a) !== kindRank(b)) return kindRank(a) - kindRank(b);
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.label.localeCompare(b.label, "sv");
  };
  const baryFrom = (cols: number[]) => {
    const ys = new Map<string, number[]>();
    for (const e of graph.edges) {
      const from = byId.get(e.from);
      if (!from || !cols.includes(column(from))) continue;
      ys.set(e.to, [...(ys.get(e.to) ?? []), from.y]);
    }
    return (n: Positioned) => {
      const list = ys.get(n.id);
      return list?.length ? list.reduce((s, y) => s + y, 0) / list.length : Number.POSITIVE_INFINITY;
    };
  };

  // Kolumn 1 utifrån frågorna; kolumn 2 utifrån både frågor (saknade) och källor (föreslagna).
  place(nodes.filter((n) => column(n) === 1).sort(compareBy(baryFrom([0]))), 1);
  place(nodes.filter((n) => column(n) === 2).sort(compareBy(baryFrom([0, 1]))), 2);

  function place(list: Positioned[], col: 0 | 1 | 2) {
    if (list.length === 0) return;
    const gap = Math.max(ROW_GAP, Math.min(72, (height - 60) / list.length));
    const total = (list.length - 1) * gap;
    const top = Math.max(30, (height - total) / 2);
    list.forEach((n, i) => {
      n.x = Math.max(n.r + 8, Math.min(width - n.r - 8, columnX[col]!));
      n.y = top + i * gap;
      n.labelChars = Math.max(6, Math.min(40, Math.floor(labelSpace[col]! / CHAR_W)));
    });
  }

  return nodes;
}

/** Grannar till en nod (för markering vid hover/val). */
export function neighbours(graph: Graph, id: string): Set<string> {
  const out = new Set<string>([id]);
  for (const e of graph.edges) {
    if (e.from === id) out.add(e.to);
    if (e.to === id) out.add(e.from);
  }
  return out;
}

export interface GraphStats {
  issues: number;
  sources: number;
  usedSources: number;
  missing: number;
  suggested: number;
  references: number;
}

export function graphStats(graph: Graph): GraphStats {
  const cited = new Set(graph.edges.filter((e) => e.kind === "cites").map((e) => e.to));
  const nodeKind = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  return {
    issues: graph.nodes.filter((n) => n.kind === "issue").length,
    sources: graph.nodes.filter((n) => n.kind === "source").length,
    usedSources: graph.nodes.filter((n) => n.kind === "source" && cited.has(n.id)).length,
    missing: graph.nodes.filter((n) => n.kind === "missing").length,
    suggested: graph.nodes.filter((n) => n.kind === "suggested").length,
    references: graph.edges.filter((e) => e.kind === "refers" && nodeKind.get(e.to) === "source").length,
  };
}
