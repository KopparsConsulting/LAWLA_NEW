/**
 * Relationsgraf för rättskällor: visar hur rättsfrågorna, rättskällorna i underlaget och
 * den samlade analysen hänger ihop – och vilka hänvisningar som inte finns i underlaget.
 *
 * Kanterna härleds helt i klienten:
 *  - rättsfråga → rättskälla: delanalysen hänvisar till källan (via `linkifyCitations`)
 *  - samlad analys → rättskälla: den samlade analysen hänvisar till källan
 *  - rättskälla → rättskälla: källornas dokument hänvisar till varandra (backendens referenser)
 *  - rättsfråga/analys → saknad hänvisning: hänvisning som inte finns i underlaget
 *
 * Layouten är en enkel, deterministisk kraftlayout (ingen extern grafbibliotek).
 */
import type { DocumentReferenceDto, ExpandedEvidenceDto, LegalIssueAnalysisDto, ProjectAnalysisDto, ProjectDetailDto } from "@/api/types";
import { linkifyCitations, normalizeKey } from "./citations";

export type SourceKind = "lagrum" | "praxis" | "forarbeten" | "doktrin" | "ovrigt";
export type NodeKind = "issue" | "analysis" | "source" | "missing";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** Underrubrik, t.ex. dokumenttitel. */
  sub?: string;
  /** Typ av rättskälla (bara för kind = "source"). */
  sourceKind?: SourceKind;
  /** Rättsfrågans id / rättskällans id / analysens id. */
  refId?: number;
  documentId?: number | null;
  /** Antal hänvisningar som pekar på noden. */
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
};

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

export function buildGraph(input: GraphInput): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  const addEdge = (from: string, to: string, kind: EdgeKind, title?: string) => {
    const id = `${kind}:${from}>${to}`;
    const existing = edges.get(id);
    if (existing) existing.weight += 1;
    else edges.set(id, { id, from, to, kind, weight: 1, title });
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
      label: trimLabel(e.displayLabel || e.documentTitle || `Källa ${e.id}`),
      sub: e.documentTitle && e.displayLabel ? trimLabel(e.documentTitle, 80) : undefined,
      sourceKind: classifySource({ ...e, documentType }),
      refId: e.id,
      documentId: e.documentId,
      weight: 0,
    });
  }

  // Rättsfrågor + delanalysernas hänvisningar
  const issues = [...(input.project.legalIssues ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  issues.forEach((issue, i) => {
    const id = issueNodeId(issue.id);
    nodes.set(id, { id, kind: "issue", label: trimLabel(issue.text || `Rättsfråga ${i + 1}`, 70), refId: issue.id, weight: 0 });
    const analysis = input.issueAnalyses.get(issue.id);
    if (!analysis?.outputContent) return;
    linkCitations(id, `Rättsfråga ${i + 1}`, analysis.outputContent);
  });

  // Samlad analys
  if (input.analysis?.outputContent) {
    nodes.set(ANALYSIS_NODE_ID, { id: ANALYSIS_NODE_ID, kind: "analysis", label: "Samlad analys", refId: input.analysis.id, weight: 0 });
    linkCitations(ANALYSIS_NODE_ID, "Samlad analys", input.analysis.outputContent);
  }

  function linkCitations(fromId: string, fromLabel: string, markdown: string) {
    const { report } = linkifyCitations(markdown, input.evidence);
    for (const c of report.citations) {
      if (c.evidenceId != null) {
        const to = sourceNodeId(c.evidenceId);
        if (!nodes.has(to)) continue;
        addEdge(fromId, to, "cites", `${fromLabel} hänvisar till ${c.text}`);
        bump(to);
      } else {
        const to = missingNodeId(c.text);
        if (!nodes.has(to)) nodes.set(to, { id: to, kind: "missing", label: trimLabel(c.text), weight: 0 });
        addEdge(fromId, to, "cites", `${fromLabel} hänvisar till ${c.text}, som saknas i underlaget`);
        bump(to);
      }
    }
  }

  // Dokumentreferenser mellan rättskällornas dokument
  if (input.references) {
    const byDoc = new Map<number, string[]>();
    for (const e of input.evidence) {
      if (e.documentId == null) continue;
      const list = byDoc.get(e.documentId) ?? [];
      list.push(sourceNodeId(e.id));
      byDoc.set(e.documentId, list);
    }
    for (const [docId, refs] of input.references) {
      const fromNodes = byDoc.get(docId);
      if (!fromNodes) continue;
      const seenTargets = new Set<number>();
      for (const r of refs) {
        if (!r.isResolved || r.targetDocumentId == null || r.targetDocumentId === docId) continue;
        const toNodes = byDoc.get(r.targetDocumentId);
        if (!toNodes || seenTargets.has(r.targetDocumentId)) continue;
        seenTargets.add(r.targetDocumentId);
        // Koppla ett representativt par per dokumentpar så grafen inte drunknar i kanter.
        addEdge(fromNodes[0]!, toNodes[0]!, "refers", `${r.displayText || r.citationText || "Hänvisning"} → ${r.targetDocumentTitle ?? ""}`.trim());
      }
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/* ─── Layout ────────────────────────────────────────────────────────── */

export interface Positioned extends GraphNode {
  x: number;
  y: number;
  r: number;
}

export interface LayoutOptions {
  width: number;
  height: number;
}

export function nodeRadius(n: GraphNode): number {
  if (n.kind === "issue") return 18;
  if (n.kind === "analysis") return 22;
  if (n.kind === "missing") return 9;
  return 10 + Math.min(10, n.weight * 2);
}

/** Minsta lodräta avstånd mellan nodcentrum i en kolumn (ger plats för etiketter). */
export const ROW_GAP = 46;

/** Kolumn per nodtyp: frågor/analys till vänster, källor i mitten, saknade hänvisningar till höger. */
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

const SOURCE_KIND_ORDER: SourceKind[] = ["lagrum", "forarbeten", "praxis", "doktrin", "ovrigt"];

/**
 * Lagerlayout i tre kolumner. Noderna i kolumn 1 och 2 sorteras efter tyngdpunkten hos de
 * frågor som hänvisar till dem (barycenter), så att kanterna korsar varandra så lite som möjligt.
 * Deterministisk: samma graf och yta ger alltid samma bild.
 */
export function layoutGraph(graph: Graph, opts: LayoutOptions): Positioned[] {
  const { width, height } = opts;
  const nodes: Positioned[] = graph.nodes.map((n) => ({ ...n, x: 0, y: 0, r: nodeRadius(n) }));
  if (nodes.length === 0) return nodes;
  if (nodes.length === 1) {
    nodes[0]!.x = width / 2;
    nodes[0]!.y = height / 2;
    return nodes;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const columnX = [Math.min(260, width * 0.27), width * 0.52, width - Math.min(150, width * 0.16)];

  // Kolumn 0: rättsfrågor i sin ordning, samlad analys sist.
  const left = nodes.filter((n) => column(n) === 0).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "analysis" ? 1 : -1));
  place(left, 0);

  // Kolumn 1 och 2: barycenter av de noder i kolumn 0 som hänvisar till noden.
  const citers = new Map<string, number[]>();
  for (const e of graph.edges) {
    if (e.kind !== "cites") continue;
    const from = byId.get(e.from);
    if (!from || column(from) !== 0) continue;
    citers.set(e.to, [...(citers.get(e.to) ?? []), from.y]);
  }
  const bary = (n: Positioned): number => {
    const ys = citers.get(n.id);
    return ys && ys.length ? ys.reduce((s, y) => s + y, 0) / ys.length : Number.POSITIVE_INFINITY;
  };
  const kindRank = (n: Positioned) => (n.sourceKind ? SOURCE_KIND_ORDER.indexOf(n.sourceKind) : 0);
  const compare = (a: Positioned, b: Positioned) => {
    const ba = bary(a);
    const bb = bary(b);
    if (ba !== bb) return ba - bb; // oanvända (Infinity) hamnar sist
    if (!Number.isFinite(ba) && kindRank(a) !== kindRank(b)) return kindRank(a) - kindRank(b);
    if (b.weight !== a.weight) return b.weight - a.weight;
    return a.label.localeCompare(b.label, "sv");
  };
  place(nodes.filter((n) => column(n) === 1).sort(compare), 1);
  place(nodes.filter((n) => column(n) === 2).sort(compare), 2);

  function place(list: Positioned[], col: 0 | 1 | 2) {
    if (list.length === 0) return;
    const gap = Math.max(ROW_GAP, Math.min(72, (height - 40) / list.length));
    const total = (list.length - 1) * gap;
    const top = Math.max(24, (height - total) / 2);
    list.forEach((n, i) => {
      n.x = Math.max(n.r + 8, Math.min(width - n.r - 8, columnX[col]!));
      n.y = Math.max(n.r + 8, Math.min(height - n.r - 8, top + i * gap));
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
  references: number;
}

export function graphStats(graph: Graph): GraphStats {
  const cited = new Set(graph.edges.filter((e) => e.kind === "cites").map((e) => e.to));
  return {
    issues: graph.nodes.filter((n) => n.kind === "issue").length,
    sources: graph.nodes.filter((n) => n.kind === "source").length,
    usedSources: graph.nodes.filter((n) => n.kind === "source" && cited.has(n.id)).length,
    missing: graph.nodes.filter((n) => n.kind === "missing").length,
    references: graph.edges.filter((e) => e.kind === "refers").length,
  };
}
