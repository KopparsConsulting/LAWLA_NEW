import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  BookPlus,
  ExternalLink,
  FlaskConical,
  Focus,
  Maximize2,
  Minus,
  Network,
  Plus,
  Scale,
  Search,
  Table2,
  X,
} from "lucide-react";
import clsx from "clsx";
import { documentsApi, projectsApi } from "@/api/client";
import type { DocumentReferenceDto, LegalIssueAnalysisDto } from "@/api/types";
import { Button, Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";
import { SourcePanel } from "./SourcePanel";
import { LAGEN_STATUS_TEXT, LagenStatusIcon, useLagenResolve } from "./lagen";
import type { CitationTarget } from "./citations";
import { CoverageMatrix } from "./CoverageMatrix";
import { LEVEL_COLOR, LevelIcon, nodeFill, SOURCE_COLORS } from "./graphUi";
import {
  assessGraph,
  buildGraph,
  buildMatrix,
  focusGraph,
  graphStats,
  layoutGraph,
  layoutHeight,
  neighbours,
  NODE_KIND_LABELS,
  SOURCE_KIND_LABELS,
  worstLevel,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type Positioned,
  type SourceKind,
  type Warning,
  type WarningLevel,
} from "./graph";

export interface Filters {
  analysis: boolean;
  references: boolean;
  missing: boolean;
  suggested: boolean;
  unused: boolean;
}

type View = "graf" | "matris";

const isNarrow = () => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 639px)").matches;

export default function GraphPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
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

  const [filters, setFilters] = useState<Filters>({ analysis: true, references: true, missing: true, suggested: true, unused: true });
  const [selected, setSelected] = useState<string | null>(() => params.get("fokus"));
  const [via, setVia] = useState<string | null>(null);
  const [sourceTarget, setSourceTarget] = useState<CitationTarget | null>(null);

  const view: View = params.get("vy") === "matris" ? "matris" : params.get("vy") === "graf" ? "graf" : isNarrow() ? "matris" : "graf";
  const focusParam = params.get("fokus");
  const setParam = (key: string, value: string | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value == null) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const fullGraph = useMemo(
    () => (project.data ? buildGraph({ project: project.data, evidence: evidence.data ?? [], issueAnalyses, analysis: latestAnalysis, references, documentTypes }) : null),
    [project.data, evidence.data, issueAnalyses, latestAnalysis, references, documentTypes],
  );
  const warnings = useMemo(
    () => (fullGraph && project.data ? assessGraph(fullGraph, { project: project.data, issueAnalyses, analysis: latestAnalysis }) : new Map<string, Warning[]>()),
    [fullGraph, project.data, issueAnalyses, latestAnalysis],
  );
  const focusNode = focusParam && fullGraph ? fullGraph.nodes.find((n) => n.id === focusParam) : undefined;
  const graph = useMemo(() => {
    if (!fullGraph) return null;
    return applyFilters(focusNode ? focusGraph(fullGraph, focusNode.id) : fullGraph, filters, focusNode?.id);
  }, [fullGraph, focusNode, filters]);
  const matrix = useMemo(() => (graph ? buildMatrix(graph) : null), [graph]);

  const addDocument = useMutation({
    mutationFn: (node: GraphNode) => projectsApi.addEvidence(id, { documentId: node.documentId ?? null, displayLabel: node.label }),
    onSuccess: (_, node) => {
      void qc.invalidateQueries({ queryKey: ["evidence", id] });
      void qc.invalidateQueries({ queryKey: ["project", id] });
      setSelected(null);
      toast(`${node.label} är tillagd i underlaget.`);
    },
    onError: (e) => toast(e.message, "error"),
  });

  if (!Number.isFinite(id)) return <Navigate to="/" replace />;
  if (project.isLoading || evidence.isLoading || analyses.isLoading || issuesLoading) return <Spinner label="Bygger relationsgrafen…" />;
  if (project.error || !project.data) return <ErrorNote error={project.error} onRetry={() => project.refetch()} />;
  if (!fullGraph || !graph || !matrix) return null;

  const stats = graphStats(fullGraph);
  const hasAnyAnalysis = issueAnalyses.size > 0 || !!latestAnalysis;
  const fullById = new Map(fullGraph.nodes.map((n) => [n.id, n]));
  const selectedNode = selected ? fullById.get(selected) : undefined;

  const select = (nodeId: string | null, viaId: string | null = null) => {
    setSelected(nodeId);
    setVia(viaId);
  };
  const focusOn = (nodeId: string | null) => {
    setParam("fokus", nodeId);
    if (nodeId) select(nodeId);
  };

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
            Vilka rättskällor varje rättsfråga och den samlade analysen bygger på, hur källorna hänvisar till varandra och vad som saknas i
            underlaget.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted">
          <Stat label="rättsfrågor" value={stats.issues} />
          <Stat label="rättskällor" value={stats.sources} />
          <Stat label="används i analys" value={stats.usedSources} />
          <Stat label="saknas i underlaget" value={stats.missing} tone={stats.missing > 0 ? "danger" : undefined} />
          {stats.suggested > 0 && <Stat label="föreslagna" value={stats.suggested} />}
        </div>
      </div>

      {stats.sources === 0 && stats.missing === 0 ? (
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

          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label="Visning" className="inline-flex rounded-md border border-line bg-surface p-0.5 text-sm">
              <TabButton active={view === "graf"} onClick={() => setParam("vy", "graf")} icon={<Network className="size-3.5" />}>
                Graf
              </TabButton>
              <TabButton active={view === "matris"} onClick={() => setParam("vy", "matris")} icon={<Table2 className="size-3.5" />}>
                Matris
              </TabButton>
            </div>
            {focusNode && (
              <p className="inline-flex min-w-0 items-center gap-2 rounded-full border border-accent/40 bg-accent-soft py-1 pl-3 pr-1 text-xs text-accent">
                <Focus className="size-3.5 shrink-0" />
                <span className="truncate">
                  Fokus: {focusNode.short ? `${focusNode.short} ` : ""}
                  {focusNode.label}
                </span>
                <button onClick={() => focusOn(null)} className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface px-2 py-0.5 hover:underline">
                  <X className="size-3" /> Visa allt
                </button>
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              {view === "graf" ? (
                <GraphView graph={graph} warnings={warnings} selected={selected} onSelect={(n) => select(n)} />
              ) : (
                <CoverageMatrix matrix={matrix} graph={graph} warnings={warnings} selected={selected} onSelect={select} />
              )}
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                {latestAnalysis && <Toggle label="Samlad analys" checked={filters.analysis} onChange={(v) => setFilters({ ...filters, analysis: v })} />}
                <Toggle label="Hänvisningar som saknas" checked={filters.missing} onChange={(v) => setFilters({ ...filters, missing: v })} />
                {view === "graf" && (
                  <>
                    <Toggle label="Korsreferenser mellan källor" checked={filters.references} onChange={(v) => setFilters({ ...filters, references: v })} />
                    {stats.suggested > 0 && <Toggle label="Föreslagna källor" checked={filters.suggested} onChange={(v) => setFilters({ ...filters, suggested: v })} />}
                  </>
                )}
                <Toggle label="Källor som inte används" checked={filters.unused} onChange={(v) => setFilters({ ...filters, unused: v })} />
              </div>
            </div>

            <aside className="min-w-0" aria-live="polite">
              {selectedNode ? (
                <NodeDetails
                  key={selectedNode.id}
                  node={selectedNode}
                  graph={fullGraph}
                  byId={fullById}
                  warnings={warnings.get(selectedNode.id)}
                  via={via}
                  projectId={id}
                  focused={focusNode?.id === selectedNode.id}
                  onSelect={(n) => select(n)}
                  onClose={() => select(null)}
                  onFocus={focusOn}
                  onOpenSource={setSourceTarget}
                  onAdd={(n) => addDocument.mutate(n)}
                  adding={addDocument.isPending}
                />
              ) : (
                <QualityOverview graph={fullGraph} warnings={warnings} onSelect={(n) => select(n)} view={view} />
              )}
            </aside>
          </div>
        </>
      )}
      {sourceTarget && <SourcePanel target={sourceTarget} evidence={evidence.data ?? []} projectId={id} onClose={() => setSourceTarget(null)} />}
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={clsx("inline-flex items-center gap-1.5 rounded px-3 py-1.5", active ? "bg-accent text-accent-ink" : "text-muted hover:text-ink")}
    >
      {icon} {children}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <span className={clsx("inline-flex items-baseline gap-1 rounded-full border px-2.5 py-1", tone === "danger" ? "border-danger/40 text-danger" : "border-line")}>
      <strong className={clsx("font-serif text-base", tone !== "danger" && "text-ink")}>{value}</strong> {label}
    </span>
  );
}

export function applyFilters(graph: Graph, f: Filters, keepId?: string): Graph {
  const cited = new Set(graph.edges.filter((e) => e.kind === "cites").map((e) => e.to));
  const nodes = graph.nodes.filter((n) => {
    if (n.id === keepId) return true;
    if (n.kind === "analysis" && !f.analysis) return false;
    if (n.kind === "missing" && !f.missing) return false;
    if (n.kind === "suggested" && (!f.suggested || !f.references)) return false;
    if (n.kind === "source" && !f.unused && !cited.has(n.id)) return false;
    return true;
  });
  const keep = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to) && (f.references || e.kind !== "refers"));
  return { nodes, edges };
}

/* ─── Kvalitetskontroll ─────────────────────────────────────────────── */

function QualityOverview({ graph, warnings, onSelect, view }: { graph: Graph; warnings: Map<string, Warning[]>; onSelect: (id: string) => void; view: View }) {
  const items = graph.nodes.filter((n) => n.kind === "issue" || n.kind === "analysis");
  const flagged = items.filter((n) => (warnings.get(n.id) ?? []).some((w) => w.level !== "info"));
  return (
    <Card className="p-4 text-sm">
      <p className="font-medium text-ink">Kvalitetskontroll</p>
      <p className="mt-1 text-xs text-muted">
        {flagged.length === 0
          ? "Inga anmärkningar: varje analyserad rättsfråga hänvisar till flera källor i underlaget."
          : `${flagged.length} av ${items.length} ${items.length === 1 ? "analys" : "analyser"} har anmärkningar. Klicka för detaljer.`}
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((n) => {
          const list = warnings.get(n.id) ?? [];
          const level = worstLevel(list);
          return (
            <li key={n.id}>
              <button onClick={() => onSelect(n.id)} className="w-full rounded-md px-1.5 py-1 text-left hover:bg-sunken">
                <span className="flex items-start gap-2">
                  <span className="mt-0.5 w-11 shrink-0 font-serif text-xs text-muted">{n.short}</span>
                  <span className="min-w-0 flex-1 text-xs leading-snug text-ink">{n.label}</span>
                  {level ? <LevelIcon level={level} /> : <span className="size-3.5 shrink-0 rounded-full bg-ok/80" aria-label="Utan anmärkning" />}
                </span>
                {list.length > 0 && (
                  <ul className="mt-1 space-y-0.5 pl-13">
                    {list.map((w) => (
                      <li key={w.code} className="text-[11px] leading-snug" style={{ color: w.level === "info" ? "var(--muted)" : LEVEL_COLOR[w.level] }}>
                        {w.text}
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <details className="mt-4 border-t border-line pt-3 text-xs text-muted">
        <summary className="cursor-pointer text-ink">Så läser du {view === "graf" ? "grafen" : "matrisen"}</summary>
        <ul className="mt-2 space-y-1.5">
          {view === "graf" ? (
            <>
              <li>Rättsfrågorna står till vänster, rättskällorna i mitten och det som ligger utanför underlaget till höger.</li>
              <li>Stora cirklar är källor som många analyser bygger på.</li>
              <li>
                <span className="text-danger">Röda, streckade</span> noder är hänvisningar som inte finns i underlaget – kontrollera dem.
              </li>
              <li>Blå, streckade noder är dokument som källorna hänvisar till men som inte finns i underlaget. De kan läggas till med ett klick.</li>
              <li>Streckade kanter visar att ett källdokument hänvisar till ett annat.</li>
              <li>Tangentbord: Tab mellan noder, Enter för detaljer, Esc för att stänga.</li>
            </>
          ) : (
            <>
              <li>Varje rad är en rättskälla, varje kolumn en rättsfråga (F1, F2 …). Siffran är antal hänvisningar.</li>
              <li>Klicka i en ruta för att se meningarna där hänvisningen står.</li>
              <li>En kolumn utan träffar betyder att analysen inte vilar på något i underlaget.</li>
            </>
          )}
        </ul>
      </details>
    </Card>
  );
}

/* ─── Själva grafen ─────────────────────────────────────────────────── */

export function GraphView({
  graph,
  warnings,
  selected,
  onSelect,
  initialWidth = 900,
}: {
  graph: Graph;
  warnings?: Map<string, Warning[]>;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Bredd innan ytan har mätts (och vid serverrendering). */
  initialWidth?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initialWidth);
  const height = layoutHeight(graph);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(300, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    setWidth(Math.max(300, Math.floor(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => layoutGraph(graph, { width, height }), [graph, width, height]);
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  useEffect(() => setOverrides({}), [graph]);
  const nodes = useMemo(() => layout.map((n) => (overrides[n.id] ? { ...n, ...overrides[n.id] } : n)), [layout, overrides]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ id: string | null; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mx: number; my: number; view: { x: number; y: number; k: number } } | null>(null);

  const focus = hover ?? (selected && byId.has(selected) ? selected : null);
  const lit = useMemo(() => (focus ? neighbours(graph, focus) : null), [graph, focus]);
  const litEdges = useMemo(() => (focus ? new Set(graph.edges.filter((e) => e.from === focus || e.to === focus).map((e) => e.id)) : null), [graph, focus]);

  const local = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  };
  const zoomAt = (px: number, py: number, k: number, from = view) => {
    const nk = Math.max(0.4, Math.min(3, k));
    return { k: nk, x: px - ((px - from.x) * nk) / from.k, y: py - ((py - from.y) * nk) / from.k };
  };

  function onPointerDown(e: ReactPointerEvent, nodeId: string | null) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (!nodeId) {
      pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch.current = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view };
        drag.current = null;
        return;
      }
    }
    const n = nodeId ? byId.get(nodeId) : null;
    drag.current = { id: nodeId, startX: e.clientX, startY: e.clientY, origX: n ? n.x : view.x, origY: n ? n.y : view.y, moved: false };
  }
  function onPointerMove(e: ReactPointerEvent) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, local(e.clientX, e.clientY));
    const p = pinch.current;
    if (p && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const z = zoomAt(p.mx, p.my, (p.view.k * dist) / p.dist, p.view);
      setView({ ...z, x: z.x + (a.x + b.x) / 2 - p.mx, y: z.y + (a.y + b.y) / 2 - p.my });
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.id) setOverrides((o) => ({ ...o, [d.id!]: { x: d.origX + dx / view.k, y: d.origY + dy / view.k } }));
    else setView((v) => ({ ...v, x: d.origX + dx, y: d.origY + dy }));
  }
  function onPointerUp(e: ReactPointerEvent, nodeId: string | null) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    onSelect(nodeId && nodeId === selected ? null : nodeId);
  }
  // Zoom med Ctrl/⌘ + scroll (och nypgest på styrplatta, som skickas som Ctrl + scroll). Vanlig scroll rullar sidan.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const k = Math.max(0.4, Math.min(3, v.k * Math.exp(-e.deltaY * 0.002)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  function zoomBy(f: number) {
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    const vh = Math.min(rect?.height ?? height, typeof window !== "undefined" ? window.innerHeight : height);
    setView((v) => zoomAt(width / 2, vh / 2, v.k * f, v));
  }
  function reset() {
    setView({ x: 0, y: 0, k: 1 });
    setOverrides({});
  }
  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "Escape") onSelect(null);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Legend hasSuggested={graph.nodes.some((n) => n.kind === "suggested")} />
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="px-2" icon={<Minus className="size-3.5" />} onClick={() => zoomBy(1 / 1.25)} aria-label="Zooma ut" />
          <Button size="sm" variant="ghost" className="px-2" icon={<Plus className="size-3.5" />} onClick={() => zoomBy(1.25)} aria-label="Zooma in" />
          <Button size="sm" variant="ghost" icon={<Maximize2 className="size-3.5" />} onClick={reset}>
            Återställ
          </Button>
        </div>
      </div>
      <div ref={containerRef} className="relative select-none overflow-hidden rounded-lg border border-line bg-surface" style={{ height }} onKeyDown={onKeyDown}>
        <svg
          width={width}
          height={height}
          role="group"
          aria-label="Relationsgraf över rättsfrågor och rättskällor"
          className="block touch-none cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => onPointerDown(e, null)}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => onPointerUp(e, null)}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
            pinch.current = null;
            drag.current = null;
          }}
          onPointerLeave={() => setHover(null)}
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
                level={worstLevel(warnings?.get(n.id))}
                dim={lit ? !lit.has(n.id) : false}
                active={n.id === focus}
                selected={n.id === selected}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onPointerDown(e, n.id);
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  onPointerUp(e, n.id);
                }}
                onEnter={() => setHover(n.id)}
                onLeave={() => setHover((h) => (h === n.id ? null : h))}
                onActivate={() => onSelect(n.id === selected ? null : n.id)}
              />
            ))}
          </g>
        </svg>
        <p className="pointer-events-none absolute bottom-2 right-3 hidden text-[11px] text-muted sm:block">
          Dra för att flytta · Ctrl/⌘ + scroll för att zooma · klicka för detaljer
        </p>
        <p className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-muted sm:hidden">Nyp för att zooma · tryck för detaljer</p>
      </div>
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

function Legend({ hasSuggested }: { hasSuggested: boolean }) {
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
      {hasSuggested && (
        <li className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-full border border-dashed border-accent" /> {NODE_KIND_LABELS.suggested}
        </li>
      )}
    </ul>
  );
}

function Edge({ edge, a, b, lit }: { edge: GraphEdge; a?: Positioned; b?: Positioned; lit: boolean | null }) {
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  // Böj kanten något så parallella kanter inte ligger på varandra. Korsreferenser mellan noder i
  // samma kolumn bågar åt vänster, bort från etiketterna.
  const sameColumn = Math.abs(dx) < 4;
  const mx = sameColumn ? (a.x + b.x) / 2 - Math.max(24, Math.abs(dy) * 0.22) : (a.x + b.x) / 2 - dy * 0.08;
  const my = sameColumn ? (a.y + b.y) / 2 : (a.y + b.y) / 2 + dx * 0.08;
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

function truncate(s: string, max: number) {
  return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s;
}

function Node({
  node: n,
  level,
  dim,
  active,
  selected,
  onPointerDown,
  onPointerUp,
  onEnter,
  onLeave,
  onActivate,
}: {
  node: Positioned;
  level: WarningLevel | null;
  dim: boolean;
  active: boolean;
  selected: boolean;
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
  onActivate: () => void;
}) {
  const missing = n.kind === "missing";
  const suggested = n.kind === "suggested";
  const outside = missing || suggested;
  const label = truncate(n.short && n.kind === "issue" ? `${n.short} ${n.label}` : n.label, n.labelChars);
  const labelLeft = n.kind === "issue" || n.kind === "analysis";
  const badge = level && level !== "info" ? level : null;
  return (
    <g
      transform={`translate(${n.x} ${n.y})`}
      className="cursor-pointer"
      opacity={dim ? 0.18 : 1}
      style={{ transition: "opacity 150ms", outline: "none" }}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${NODE_KIND_LABELS[n.kind]}: ${n.label}${badge ? " – har anmärkningar" : ""}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
    >
      <title>{[NODE_KIND_LABELS[n.kind], n.label, n.sub].filter(Boolean).join(" – ")}</title>
      {(active || selected) && <circle r={n.r + 6} fill="var(--accent)" fillOpacity={selected ? 0.25 : 0.15} />}
      <circle
        r={n.r}
        fill={nodeFill(n)}
        stroke={missing ? "var(--danger)" : suggested ? "var(--accent)" : active ? "var(--accent)" : "var(--surface)"}
        strokeWidth={outside ? 1.5 : 2}
        strokeDasharray={outside ? "3 2" : undefined}
      />
      {n.kind === "issue" && <Scale x={-9} y={-9} width={18} height={18} color="var(--accent-ink)" strokeWidth={2} />}
      {n.kind === "analysis" && <FlaskConical x={-10} y={-10} width={20} height={20} color="var(--paper)" strokeWidth={2} />}
      {missing && <AlertTriangle x={-6} y={-6} width={12} height={12} color="var(--danger)" strokeWidth={2.2} />}
      {suggested && <Plus x={-6} y={-6} width={12} height={12} color="var(--accent)" strokeWidth={2.4} />}
      {badge && <circle cx={n.r * 0.72} cy={-n.r * 0.72} r={5} fill={LEVEL_COLOR[badge]} stroke="var(--surface)" strokeWidth={1.5} />}
      <text
        x={labelLeft ? -(n.r + 8) : n.r + 8}
        y={4}
        textAnchor={labelLeft ? "end" : "start"}
        fontSize={n.kind === "source" ? 11.5 : 12}
        fontWeight={n.kind === "source" || suggested ? 400 : 500}
        fill={missing ? "var(--danger)" : suggested ? "var(--accent)" : "var(--ink)"}
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

/* ─── Detaljpanel ───────────────────────────────────────────────────── */

export function NodeDetails({
  node,
  graph,
  byId,
  warnings,
  via,
  projectId,
  focused,
  onSelect,
  onClose,
  onFocus,
  onOpenSource,
  onAdd,
  adding,
}: {
  node: GraphNode;
  graph: Graph;
  byId: Map<string, GraphNode>;
  warnings?: Warning[];
  /** Kanten som ledde hit (t.ex. en ruta i matrisen) – visas först och utfälld. */
  via?: string | null;
  projectId: number;
  focused: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  onFocus: (id: string | null) => void;
  onOpenSource: (t: CitationTarget) => void;
  onAdd: (n: GraphNode) => void;
  adding: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lagen = useLagenResolve(node.kind === "missing" ? node.label : null);
  useEffect(() => {
    // I smal vy hamnar panelen under grafen/matrisen – rulla dit.
    if (isNarrow()) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [node.id, via]);

  type Link_ = { edge: GraphEdge; other: GraphNode };
  const pick = (dir: "in" | "out", kind: GraphEdge["kind"]) =>
    graph.edges
      .filter((e) => e.kind === kind && (dir === "in" ? e.to === node.id : e.from === node.id))
      .map((e) => ({ edge: e, other: byId.get(dir === "in" ? e.from : e.to) }))
      .filter((x): x is Link_ => !!x.other)
      .sort((a, b) => (a.other.id === via ? -1 : b.other.id === via ? 1 : 0));
  const citedBy = pick("in", "cites");
  const cites = pick("out", "cites");
  const refsOut = pick("out", "refers");
  const refsIn = pick("in", "refers");
  const refsInside = refsOut.filter((x) => x.other.kind === "source");
  const refsOutside = refsOut.filter((x) => x.other.kind !== "source");
  const canAdd = (node.kind === "suggested" || node.kind === "missing") && node.documentId != null;
  const isIssue = node.kind === "issue";

  return (
    <div ref={ref} className="scroll-mt-4">
      <Card className="p-4 text-sm">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {node.kind === "source" && node.sourceKind ? SOURCE_KIND_LABELS[node.sourceKind] : NODE_KIND_LABELS[node.kind]}
            {node.short && node.kind === "issue" ? ` · ${node.short}` : ""}
          </p>
          <button onClick={onClose} className="-mr-1 -mt-1 rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Stäng">
            <X className="size-4" />
          </button>
        </div>
        <h2 className={clsx("mt-1 font-serif text-lg leading-snug", node.kind === "missing" && "text-danger")}>{node.label}</h2>
        {node.sub && <p className="text-xs text-muted">{node.kind === "suggested" ? `Hänvisas till som: ${node.sub}` : node.sub}</p>}

        {warnings && warnings.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {warnings.map((w) => (
              <li key={w.code} className="flex items-start gap-2 text-xs leading-snug" style={{ color: w.level === "info" ? "var(--muted)" : LEVEL_COLOR[w.level] }}>
                <LevelIcon level={w.level} className="mt-px size-3.5" /> {w.text}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {node.kind === "source" && node.refId != null && (
            <Button size="sm" variant="secondary" icon={<BookOpen className="size-3.5" />} onClick={() => onOpenSource({ kind: "evidence", evidenceId: node.refId! })}>
              Visa textstället
            </Button>
          )}
          {canAdd && (
            <Button size="sm" icon={<BookPlus className="size-3.5" />} loading={adding} onClick={() => onAdd(node)}>
              Lägg till i underlaget
            </Button>
          )}
          {node.kind === "missing" && (
            <Button size="sm" variant="secondary" icon={<Search className="size-3.5" />} onClick={() => onOpenSource({ kind: "search", query: node.label })}>
              Kontrollera
            </Button>
          )}
          {(isIssue || node.kind === "analysis") && (
            <Link
              to={isIssue ? `/utredning/${projectId}/delanalyser?fraga=${node.refId}` : `/utredning/${projectId}/analys`}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-line px-2.5 text-xs hover:bg-sunken"
            >
              {isIssue ? "Öppna delanalysen" : "Öppna analysen"} <ExternalLink className="size-3" />
            </Link>
          )}
          <Button size="sm" variant="ghost" icon={<Focus className="size-3.5" />} onClick={() => onFocus(focused ? null : node.id)}>
            {focused ? "Visa allt" : "Fokusera"}
          </Button>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3">
          {(node.kind === "source" || canAdd) && node.documentId != null && (
            <Link to={`/dokument/${node.documentId}`} className="inline-flex h-7 items-center gap-1 text-xs text-accent hover:underline">
              Öppna dokumentet <ExternalLink className="size-3" />
            </Link>
          )}
          {node.kind === "missing" && (
            <Link to={`/utredning/${projectId}/rattskallor?sok=${encodeURIComponent(node.label)}`} className="inline-flex h-7 items-center text-xs text-accent hover:underline">
              Sök stycke i rättskällesteget
            </Link>
          )}
        </div>

        {node.kind === "missing" && (
          <p className="mt-3 rounded-md border border-danger/30 bg-danger/5 p-2.5 text-xs text-danger">
            {node.documentId != null
              ? "Hänvisningen finns inte bland utredningens rättskällor, men dokumentet finns i Lawlas korpus och källorna hänvisar dit. Lägg till det eller kontrollera hänvisningen."
              : "Hänvisningen finns inte bland utredningens rättskällor och kunde inte hittas bland källornas hänvisningar. Verifiera den eller lägg till källan i underlaget."}
          </p>
        )}
        {node.kind === "missing" && (
          <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug">
            <LagenStatusIcon status={lagen.data?.status} loading={lagen.isLoading} className="mt-px size-3.5" />
            <span>
              {lagen.isLoading
                ? "Kontrollerar på lagen.nu…"
                : lagen.data
                  ? `${LAGEN_STATUS_TEXT[lagen.data.status]}${lagen.data.status === "found" && lagen.data.title ? `: ${[lagen.data.pinLabel, lagen.data.title].filter(Boolean).join(" ")}` : ""}. `
                  : "lagen.nu kunde inte nås. "}
              {!lagen.isLoading && (
                <button className="text-accent underline" onClick={() => onOpenSource({ kind: "search", query: node.label })}>
                  {lagen.data?.status === "found" ? "Visa textstället och lägg till" : "Kontrollera"}
                </button>
              )}
            </span>
          </p>
        )}
        {node.kind === "suggested" && (
          <p className="mt-3 rounded-md bg-accent-soft p-2.5 text-xs text-accent">
            Dokumentet finns inte i underlaget, men {node.weight === 1 ? "en av källorna" : `${node.weight} av källorna`} hänvisar till det.
          </p>
        )}

        {citedBy.length > 0 && (
          <Section title={node.kind === "missing" ? "Hänvisas till av" : "Används av"}>
            {citedBy.map(({ edge, other }) => (
              <Row key={edge.id} node={other} count={edge.weight} contexts={edge.contexts} open={other.id === via} onSelect={onSelect} />
            ))}
          </Section>
        )}
        {cites.length > 0 && (
          <Section title="Bygger på">
            {cites.map(({ edge, other }) => (
              <Row key={edge.id} node={other} count={edge.weight} contexts={edge.contexts} open={other.id === via} onSelect={onSelect} />
            ))}
          </Section>
        )}
        {refsInside.length > 0 && (
          <Section title="Hänvisar till i underlaget">
            {refsInside.map(({ edge, other }) => (
              <Row key={edge.id} node={other} onSelect={onSelect} hint={edge.title} />
            ))}
          </Section>
        )}
        {refsOutside.length > 0 && (
          <Section title="Hänvisar till utanför underlaget">
            {refsOutside.map(({ edge, other }) => (
              <Row key={edge.id} node={other} onSelect={onSelect} hint={edge.title} />
            ))}
          </Section>
        )}
        {refsIn.length > 0 && (
          <Section title={node.kind === "source" ? "Andra källor som hänvisar hit" : "Källor som hänvisar hit"}>
            {refsIn.map(({ edge, other }) => (
              <Row key={edge.id} node={other} onSelect={onSelect} hint={edge.title} />
            ))}
          </Section>
        )}
        {citedBy.length === 0 && cites.length === 0 && refsOut.length === 0 && refsIn.length === 0 && (
          <p className="mt-3 text-xs text-muted">
            {node.kind === "source"
              ? "Ingen analys hänvisar till den här källan ännu."
              : isIssue
                ? "Ingen delanalys har körts för rättsfrågan, eller så saknar den hänvisningar."
                : "Inga kopplingar."}
          </p>
        )}
      </Card>
    </div>
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

function Row({
  node,
  count,
  hint,
  contexts,
  open: initiallyOpen = false,
  onSelect,
}: {
  node: GraphNode;
  count?: number;
  hint?: string;
  contexts?: string[];
  open?: boolean;
  onSelect: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const outside = node.kind === "missing" || node.kind === "suggested";
  const shown = contexts ? (all || initiallyOpen ? contexts : contexts.slice(0, 1)) : [];
  return (
    <li className={clsx("rounded", initiallyOpen && "bg-accent-soft/60")}>
      <button onClick={() => onSelect(node.id)} className="flex w-full items-start gap-2 rounded px-1.5 py-1 text-left hover:bg-sunken" title={hint}>
        <span
          className={clsx(
            "mt-1 size-2.5 shrink-0 rounded-full",
            node.kind === "missing" && "border border-dashed border-danger",
            node.kind === "suggested" && "border border-dashed border-accent",
          )}
          style={{ background: outside ? "transparent" : nodeFill(node) }}
        />
        <span className={clsx("min-w-0 flex-1 text-xs leading-snug", node.kind === "missing" && "text-danger", node.kind === "suggested" && "text-accent")}>
          {node.short && node.kind === "issue" ? <span className="mr-1 font-serif text-muted">{node.short}</span> : null}
          {node.label}
        </span>
        {count != null && count > 1 && <span className="shrink-0 text-[11px] text-muted">×{count}</span>}
      </button>
      {shown.length > 0 && (
        <div className="mb-1 ml-6 mr-1.5 space-y-1">
          {shown.map((c) => (
            <blockquote key={c} className="border-l-2 border-line pl-2 text-[11px] leading-snug text-muted">
              {c}
            </blockquote>
          ))}
          {contexts && contexts.length > shown.length && (
            <button onClick={() => setAll(true)} className="text-[11px] text-accent hover:underline">
              Visa {contexts.length - shown.length} till
            </button>
          )}
        </div>
      )}
    </li>
  );
}
