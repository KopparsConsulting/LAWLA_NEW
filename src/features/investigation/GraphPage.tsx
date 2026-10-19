import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, BookOpen, ExternalLink, FlaskConical, Maximize2, Scale, Search } from "lucide-react";
import clsx from "clsx";
import { documentsApi, projectsApi } from "@/api/client";
import type { DocumentReferenceDto, ExpandedEvidenceDto, LegalIssueAnalysisDto } from "@/api/types";
import { Button, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { SourcePanel } from "./SourcePanel";
import type { CitationTarget } from "./citations";
import {
  buildGraph,
  graphStats,
  layoutGraph,
  layoutRows,
  neighbours,
  ROW_GAP,
  NODE_KIND_LABELS,
  SOURCE_KIND_LABELS,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Positioned,
  type SourceKind,
} from "./graph";

const SOURCE_COLORS: Record<SourceKind, string> = {
  lagrum: "var(--g-lagrum)",
  praxis: "var(--g-praxis)",
  forarbeten: "var(--g-forarbeten)",
  doktrin: "var(--g-doktrin)",
  ovrigt: "var(--g-ovrigt)",
};

function nodeFill(n: GraphNode): string {
  if (n.kind === "issue") return "var(--accent)";
  if (n.kind === "analysis") return "var(--ink)";
  if (n.kind === "missing") return "var(--surface)";
  return SOURCE_COLORS[n.sourceKind ?? "ovrigt"];
}

export interface Filters {
  analysis: boolean;
  references: boolean;
  missing: boolean;
  unused: boolean;
}

export default function GraphPage() {
  const id = Number(useParams().id);
  const project = useQuery({ queryKey: ["project", id], queryFn: () => projectsApi.get(id), enabled: Number.isFinite(id) });
  const evidence = useQuery({ queryKey: ["evidence", id], queryFn: () => projectsApi.evidence(id), enabled: Number.isFinite(id) });
  const analyses = useQuery({ queryKey: ["analyses", id], queryFn: () => projectsApi.analyses(id), enabled: Number.isFinite(id) });
  const issues = project.data?.legalIssues ?? [];

  const { loading: issuesLoading, issueAnalyses } = useQueries({
    queries: issues.map((issue) => ({
      queryKey: ["issueAnalyses", id, issue.id],
      queryFn: () => projectsApi.issueAnalyses(id, issue.id),
      enabled: issue.analysisCount > 0,
    })),
    combine: (results) => {
      const map = new Map<number, LegalIssueAnalysisDto>();
      results.forEach((r, i) => {
        const latest = [...(r.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        const issue = issues[i];
        if (latest && issue) map.set(issue.id, latest);
      });
      return { loading: results.some((r) => r.isLoading), issueAnalyses: map };
    },
  });

  const documentIds = useMemo(
    () => [...new Set((evidence.data ?? []).map((e) => e.documentId).filter((d): d is number => d != null))].sort((a, b) => a - b),
    [evidence.data],
  );
  const { references, documentTypes } = useQueries({
    queries: documentIds.flatMap((docId) => [
      { queryKey: ["refsOut", docId], queryFn: () => documentsApi.outgoing(docId), staleTime: 10 * 60_000 },
      { queryKey: ["document", docId], queryFn: () => documentsApi.get(docId), staleTime: 10 * 60_000 },
    ]),
    combine: (results) => {
      const references = new Map<number, DocumentReferenceDto[]>();
      const documentTypes = new Map<number, string | null>();
      documentIds.forEach((docId, i) => {
        const refs = results[i * 2]?.data as DocumentReferenceDto[] | undefined;
        const doc = results[i * 2 + 1]?.data as { documentType: string | null } | undefined;
        if (refs) references.set(docId, refs);
        if (doc) documentTypes.set(docId, doc.documentType);
      });
      return { references, documentTypes };
    },
  });

  const latestAnalysis = useMemo(() => [...(analyses.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null, [analyses.data]);

  const [filters, setFilters] = useState<Filters>({ analysis: true, references: true, missing: true, unused: true });

  const fullGraph = useMemo(
    () => (project.data ? buildGraph({ project: project.data, evidence: evidence.data ?? [], issueAnalyses, analysis: latestAnalysis, references, documentTypes }) : null),
    [project.data, evidence.data, issueAnalyses, latestAnalysis, references, documentTypes],
  );
  const graph = useMemo(() => (fullGraph ? applyFilters(fullGraph, filters) : null), [fullGraph, filters]);

  if (!Number.isFinite(id)) return <Navigate to="/" replace />;
  if (project.isLoading || evidence.isLoading || analyses.isLoading || issuesLoading) return <Spinner label="Bygger relationsgrafen…" />;
  if (project.error || !project.data) return <ErrorNote error={project.error} onRetry={() => project.refetch()} />;
  if (!fullGraph || !graph) return null;

  const stats = graphStats(fullGraph);
  const hasAnyAnalysis = issueAnalyses.size > 0 || !!latestAnalysis;

  return (
    <div>
      <Link to={`/utredning/${id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Tillbaka till utredningen
      </Link>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{project.data.title || "Namnlös utredning"}</p>
          <h1 className="mt-1 font-serif text-3xl leading-tight">Relationsgraf</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Hur rättsfrågorna, rättskällorna och analyserna hänger ihop. Kanterna bygger på hänvisningar i delanalyserna och den samlade
            analysen samt på hur källornas dokument hänvisar till varandra.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted">
          <Stat label="rättsfrågor" value={stats.issues} />
          <Stat label="rättskällor" value={stats.sources} />
          <Stat label="används i analys" value={stats.usedSources} />
          <Stat label="saknas i underlaget" value={stats.missing} tone={stats.missing > 0 ? "danger" : undefined} />
          <Stat label="korsreferenser" value={stats.references} />
        </div>
      </div>

      {stats.sources === 0 ? (
        <EmptyState title="Inga rättskällor att visa ännu">
          <Link to={`/utredning/${id}/rattskallor`} className="text-accent underline">
            Koppla rättskällor till utredningen
          </Link>{" "}
          så ritas grafen upp.
        </EmptyState>
      ) : (
        <>
          {!hasAnyAnalysis && (
            <p className="mb-4 rounded-md bg-accent-soft p-3 text-sm text-accent">
              Inga analyser har körts ännu, så grafen visar bara rättskällorna och deras korsreferenser. Kör{" "}
              <Link to={`/utredning/${id}/delanalyser`} className="underline">
                delanalyser
              </Link>{" "}
              för att se vilka källor varje rättsfråga vilar på.
            </p>
          )}
          <GraphView graph={graph} evidence={evidence.data ?? []} projectId={id} filters={filters} onFilters={setFilters} showAnalysisToggle={!!latestAnalysis} />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <span className={clsx("inline-flex items-baseline gap-1 rounded-full border px-2.5 py-1", tone === "danger" ? "border-danger/40 text-danger" : "border-line")}>
      <strong className={clsx("font-serif text-base", tone !== "danger" && "text-ink")}>{value}</strong> {label}
    </span>
  );
}

function applyFilters(graph: Graph, f: Filters): Graph {
  const cited = new Set(graph.edges.filter((e) => e.kind === "cites").map((e) => e.to));
  const nodes = graph.nodes.filter((n) => {
    if (n.kind === "analysis" && !f.analysis) return false;
    if (n.kind === "missing" && !f.missing) return false;
    if (n.kind === "source" && !f.unused && !cited.has(n.id)) return false;
    return true;
  });
  const keep = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to) && (f.references || e.kind !== "refers"));
  return { nodes, edges };
}

/* ─── Själva grafen ─────────────────────────────────────────────────── */

export function GraphView({
  graph,
  evidence,
  projectId,
  filters,
  onFilters,
  showAnalysisToggle,
  initialWidth = 900,
}: {
  graph: Graph;
  evidence: ExpandedEvidenceDto[];
  projectId: number;
  filters: Filters;
  onFilters: (f: Filters) => void;
  showAnalysisToggle: boolean;
  /** Bredd innan ytan har mätts (och vid serverrendering). */
  initialWidth?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initialWidth);
  const height = Math.max(480, Math.min(1100, 80 + layoutRows(graph) * ROW_GAP));

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(480, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    setWidth(Math.max(480, Math.floor(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => layoutGraph(graph, { width, height }), [graph, width, height]);
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  useEffect(() => setOverrides({}), [graph]);
  const nodes = useMemo(() => layout.map((n) => (overrides[n.id] ? { ...n, ...overrides[n.id] } : n)), [layout, overrides]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sourceTarget, setSourceTarget] = useState<CitationTarget | null>(null);
  const drag = useRef<{ id: string | null; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (selected && !byId.has(selected)) setSelected(null);
  }, [byId, selected]);

  const focus = hover ?? selected;
  const lit = useMemo(() => (focus ? neighbours(graph, focus) : null), [graph, focus]);
  const litEdges = useMemo(() => (focus ? new Set(graph.edges.filter((e) => e.from === focus || e.to === focus).map((e) => e.id)) : null), [graph, focus]);

  function onPointerDown(e: ReactPointerEvent, nodeId: string | null) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const n = nodeId ? byId.get(nodeId) : null;
    drag.current = { id: nodeId, startX: e.clientX, startY: e.clientY, origX: n ? n.x : view.x, origY: n ? n.y : view.y, moved: false };
  }
  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.id) setOverrides((o) => ({ ...o, [d.id!]: { x: d.origX + dx / view.k, y: d.origY + dy / view.k } }));
    else setView((v) => ({ ...v, x: d.origX + dx, y: d.origY + dy }));
  }
  function onPointerUp(nodeId: string | null) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) setSelected(nodeId && nodeId === selected ? null : nodeId);
  }
  // Zoom med scrollhjul – registreras som icke-passiv lyssnare så att sidan inte scrollar samtidigt.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const k = Math.max(0.4, Math.min(3, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  function reset() {
    setView({ x: 0, y: 0, k: 1 });
    setOverrides({});
  }

  const selectedNode = selected ? byId.get(selected) : undefined;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Legend />
          <Button size="sm" variant="ghost" icon={<Maximize2 className="size-3.5" />} onClick={reset}>
            Återställ vy
          </Button>
        </div>
        <div
          ref={containerRef}
          className="relative select-none overflow-hidden rounded-lg border border-line bg-surface"
          style={{ height }}
        >
          <svg
            width={width}
            height={height}
            role="img"
            aria-label="Relationsgraf över rättsfrågor och rättskällor"
            className={clsx("block touch-none", drag.current?.id === null ? "cursor-grabbing" : "cursor-grab")}
            onPointerDown={(e) => onPointerDown(e, null)}
            onPointerMove={onPointerMove}
            onPointerUp={() => onPointerUp(null)}
            onPointerLeave={() => {
              drag.current = null;
              setHover(null);
            }}
          >
            <defs>
              <marker id="g-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--muted)" />
              </marker>
              <marker id="g-arrow-lit" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
              </marker>
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {graph.edges.map((e) => (
                <Edge key={e.id} edge={e} a={byId.get(e.from)} b={byId.get(e.to)} lit={litEdges ? litEdges.has(e.id) : null} />
              ))}
              {nodes.map((n) => (
                <Node
                  key={n.id}
                  node={n}
                  dim={lit ? !lit.has(n.id) : false}
                  active={n.id === focus}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onPointerDown(e, n.id);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    onPointerUp(n.id);
                  }}
                  onEnter={() => setHover(n.id)}
                  onLeave={() => setHover((h) => (h === n.id ? null : h))}
                />
              ))}
            </g>
          </svg>
          <p className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-muted">Dra för att flytta · scrolla för att zooma · klicka för detaljer</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          {showAnalysisToggle && <Toggle label="Samlad analys" checked={filters.analysis} onChange={(v) => onFilters({ ...filters, analysis: v })} />}
          <Toggle label="Korsreferenser mellan källor" checked={filters.references} onChange={(v) => onFilters({ ...filters, references: v })} />
          <Toggle label="Hänvisningar som saknas" checked={filters.missing} onChange={(v) => onFilters({ ...filters, missing: v })} />
          <Toggle label="Källor som inte används" checked={filters.unused} onChange={(v) => onFilters({ ...filters, unused: v })} />
        </div>
      </div>

      <aside className="min-w-0">
        {selectedNode ? (
          <NodeDetails node={selectedNode} graph={graph} byId={byId} projectId={projectId} onSelect={setSelected} onOpenSource={setSourceTarget} />
        ) : (
          <Card className="p-4 text-sm text-muted">
            <p className="font-medium text-ink">Välj en nod</p>
            <p className="mt-1">Klicka på en rättsfråga, rättskälla eller hänvisning för att se vad den är kopplad till och öppna textstället.</p>
            <ul className="mt-3 space-y-1.5">
              <li>
                <span className="font-medium text-ink">Stora cirklar</span> i mitten är källor som många analyser bygger på.
              </li>
              <li>
                <span className="font-medium text-danger">Röda, streckade</span> noder är hänvisningar Lawla gjort som inte finns i underlaget – kontrollera dem.
              </li>
              <li>
                <span className="font-medium text-ink">Streckade kanter</span> visar att ett källdokument hänvisar till ett annat.
              </li>
            </ul>
          </Card>
        )}
      </aside>

      {sourceTarget && <SourcePanel target={sourceTarget} evidence={evidence} projectId={projectId} onClose={() => setSourceTarget(null)} />}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" />
      {label}
    </label>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      <li className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-full" style={{ background: "var(--accent)" }} /> {NODE_KIND_LABELS.issue}
      </li>
      {(Object.keys(SOURCE_KIND_LABELS) as SourceKind[]).map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full" style={{ background: SOURCE_COLORS[k] }} /> {SOURCE_KIND_LABELS[k]}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-full border border-dashed border-danger" /> {NODE_KIND_LABELS.missing}
      </li>
    </ul>
  );
}

function Edge({ edge, a, b, lit }: { edge: GraphEdge; a?: Positioned; b?: Positioned; lit: boolean | null }) {
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  // Böj kanten något så parallella kanter inte ligger på varandra. Korsreferenser går mellan
  // noder i samma kolumn och bågar därför åt vänster, bort från etiketterna.
  const refers = edge.kind === "refers";
  const mx = refers ? (a.x + b.x) / 2 - Math.max(24, Math.abs(dy) * 0.22) : (a.x + b.x) / 2 - dy * 0.08;
  const my = refers ? (a.y + b.y) / 2 : (a.y + b.y) / 2 + dx * 0.08;
  // Sluta kanten vid målnodens kant så pilen syns.
  const tx = b.x - (dx / d) * (b.r + 2);
  const ty = b.y - (dy / d) * (b.r + 2);
  const sx = a.x + (dx / d) * a.r;
  const sy = a.y + (dy / d) * a.r;
  const stroke = lit ? "var(--accent)" : "var(--muted)";
  return (
    <path
      d={`M${sx},${sy} Q${mx},${my} ${tx},${ty}`}
      fill="none"
      stroke={stroke}
      strokeWidth={lit ? 1.5 + Math.min(3, edge.weight * 0.6) : 1 + Math.min(2.5, edge.weight * 0.5)}
      strokeOpacity={lit === false ? 0.12 : lit ? 0.95 : 0.4}
      strokeDasharray={edge.kind === "refers" ? "4 4" : undefined}
      markerEnd={`url(#${lit ? "g-arrow-lit" : "g-arrow"})`}
      style={{ transition: "stroke-opacity 150ms" }}
    >
      {edge.title && <title>{edge.title}</title>}
    </path>
  );
}

function Node({
  node: n,
  dim,
  active,
  onPointerDown,
  onPointerUp,
  onEnter,
  onLeave,
}: {
  node: Positioned;
  dim: boolean;
  active: boolean;
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const missing = n.kind === "missing";
  const label = n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label;
  const labelLeft = n.kind === "issue" || n.kind === "analysis";
  return (
    <g
      transform={`translate(${n.x} ${n.y})`}
      className="cursor-pointer"
      opacity={dim ? 0.18 : 1}
      style={{ transition: "opacity 150ms" }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      role="button"
      aria-label={`${NODE_KIND_LABELS[n.kind]}: ${n.label}`}
    >
      <title>{[NODE_KIND_LABELS[n.kind], n.label, n.sub].filter(Boolean).join(" – ")}</title>
      {active && <circle r={n.r + 6} fill="var(--accent)" fillOpacity={0.15} />}
      <circle
        r={n.r}
        fill={nodeFill(n)}
        stroke={missing ? "var(--danger)" : active ? "var(--accent)" : "var(--surface)"}
        strokeWidth={missing ? 1.5 : 2}
        strokeDasharray={missing ? "3 2" : undefined}
      />
      {n.kind === "issue" && <Scale x={-9} y={-9} width={18} height={18} color="var(--accent-ink)" strokeWidth={2} />}
      {n.kind === "analysis" && <FlaskConical x={-10} y={-10} width={20} height={20} color="var(--paper)" strokeWidth={2} />}
      {missing && <AlertTriangle x={-6} y={-6} width={12} height={12} color="var(--danger)" strokeWidth={2.2} />}
      <text
        x={labelLeft ? -(n.r + 8) : n.r + 8}
        y={4}
        textAnchor={labelLeft ? "end" : "start"}
        fontSize={n.kind === "source" ? 11.5 : 12}
        fontWeight={n.kind === "source" ? 400 : 500}
        fill={missing ? "var(--danger)" : "var(--ink)"}
        paintOrder="stroke"
        stroke="var(--surface)"
        strokeWidth={3}
        strokeLinejoin="round"
        style={{ pointerEvents: "none" }}
      >
        {label}
      </text>
    </g>
  );
}

function NodeDetails({
  node,
  graph,
  byId,
  projectId,
  onSelect,
  onOpenSource,
}: {
  node: Positioned;
  graph: Graph;
  byId: Map<string, Positioned>;
  projectId: number;
  onSelect: (id: string | null) => void;
  onOpenSource: (t: CitationTarget) => void;
}) {
  const incoming = graph.edges.filter((e) => e.to === node.id).map((e) => ({ edge: e, other: byId.get(e.from) })).filter((x) => x.other);
  const outgoing = graph.edges.filter((e) => e.from === node.id).map((e) => ({ edge: e, other: byId.get(e.to) })).filter((x) => x.other);
  const citedBy = incoming.filter((x) => x.edge.kind === "cites");
  const cites = outgoing.filter((x) => x.edge.kind === "cites");
  const refs = [...outgoing.filter((x) => x.edge.kind === "refers"), ...incoming.filter((x) => x.edge.kind === "refers")];

  return (
    <Card className="p-4 text-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {node.kind === "source" && node.sourceKind ? SOURCE_KIND_LABELS[node.sourceKind] : NODE_KIND_LABELS[node.kind]}
      </p>
      <h2 className={clsx("mt-1 font-serif text-lg leading-snug", node.kind === "missing" && "text-danger")}>{node.label}</h2>
      {node.sub && <p className="text-xs text-muted">{node.sub}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {node.kind === "source" && node.refId != null && (
          <Button size="sm" variant="secondary" icon={<BookOpen className="size-3.5" />} onClick={() => onOpenSource({ kind: "evidence", evidenceId: node.refId! })}>
            Visa textstället
          </Button>
        )}
        {node.kind === "source" && node.documentId != null && (
          <Link to={`/dokument/${node.documentId}`} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-accent hover:underline">
            Öppna dokumentet <ExternalLink className="size-3" />
          </Link>
        )}
        {node.kind === "missing" && (
          <>
            <Button size="sm" variant="secondary" icon={<Search className="size-3.5" />} onClick={() => onOpenSource({ kind: "search", query: node.label })}>
              Kontrollera
            </Button>
            <Link to={`/utredning/${projectId}/rattskallor`} className="inline-flex h-8 items-center px-2 text-xs text-accent hover:underline">
              Lägg till som rättskälla
            </Link>
          </>
        )}
        {node.kind === "issue" && (
          <Link to={`/utredning/${projectId}/delanalyser`} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-xs hover:bg-sunken">
            Öppna delanalysen <ExternalLink className="size-3" />
          </Link>
        )}
        {node.kind === "analysis" && (
          <Link to={`/utredning/${projectId}/analys`} className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-xs hover:bg-sunken">
            Öppna analysen <ExternalLink className="size-3" />
          </Link>
        )}
      </div>

      {node.kind === "missing" && (
        <p className="mt-3 rounded-md border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">
          Hänvisningen finns inte bland utredningens rättskällor. Verifiera den eller lägg till källan i underlaget.
        </p>
      )}

      {citedBy.length > 0 && (
        <Section title={node.kind === "missing" ? "Hänvisas till av" : "Används av"}>
          {citedBy.map(({ edge, other }) => (
            <Row key={edge.id} node={other!} count={edge.weight} onSelect={onSelect} />
          ))}
        </Section>
      )}
      {cites.length > 0 && (
        <Section title="Bygger på">
          {cites.map(({ edge, other }) => (
            <Row key={edge.id} node={other!} count={edge.weight} onSelect={onSelect} />
          ))}
        </Section>
      )}
      {refs.length > 0 && (
        <Section title="Korsreferenser">
          {refs.map(({ edge, other }) => (
            <Row key={edge.id} node={other!} onSelect={onSelect} hint={edge.title} />
          ))}
        </Section>
      )}
      {citedBy.length === 0 && cites.length === 0 && refs.length === 0 && (
        <p className="mt-3 text-xs text-muted">
          {node.kind === "source" ? "Ingen analys hänvisar till den här källan ännu." : node.kind === "issue" ? "Ingen delanalys har körts för rättsfrågan, eller så saknar den hänvisningar." : "Inga kopplingar."}
        </p>
      )}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function Row({ node, count, hint, onSelect }: { node: Positioned; count?: number; hint?: string; onSelect: (id: string) => void }) {
  return (
    <li>
      <button onClick={() => onSelect(node.id)} className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-sunken" title={hint}>
        <span
          className={clsx("mt-1 size-2.5 shrink-0 rounded-full", node.kind === "missing" && "border border-dashed border-danger")}
          style={{ background: node.kind === "missing" ? "transparent" : nodeFill(node) }}
        />
        <span className={clsx("min-w-0 flex-1 text-xs leading-snug", node.kind === "missing" && "text-danger")}>{node.label}</span>
        {count != null && count > 1 && <span className="shrink-0 text-[11px] text-muted">×{count}</span>}
      </button>
    </li>
  );
}
