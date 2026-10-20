/**
 * Arbetsytan: arbeta med rättskällorna bredvid analysen.
 *
 *   [ Innehåll / Underlag ] | [ flikar: en rättskälla per flik ] | [ analysen ]
 *
 * Utan öppen källa tar analysen mittenplatsen; när en källa öppnas (från en hänvisning,
 * underlaget eller "Öppna rättskälla") flyttas analysen åt höger och blir smalare. Panelerna
 * dras till önskad bredd. Öppna flikar, aktiv flik och vald analys ligger i adressen.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowLeft,
  BookOpen,
  Columns2,
  ExternalLink,
  FileText,
  ListTree,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Scale,
  Search,
  X,
} from "lucide-react";
import { documentsApi, lagenApi, projectsApi } from "@/api/client";
import type { ExpandedEvidenceDto, LegalIssueAnalysisDto, ProjectAnalysisDto } from "@/api/types";
import { ExpandableText } from "@/components/ExpandableText";
import { Button, ErrorNote, Input, Spinner } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { CitationTarget } from "@/features/investigation/citations";
import { CitedMarkdown, SourcePanel } from "@/features/investigation/SourcePanel";
import { fragmentOf, parseSourceKey, sourceKey, stripFragment, type SourceRef } from "../../../shared/sourceDoc";
import { clamp, Splitter, useNarrow, usePaneSizes, useWidth } from "./panes";
import type { LoadedSource } from "./sources";
import { evidenceByAnchor, evidenceLocation, useSource } from "./sources";
import { SourceViewer, type ScrollRequest } from "./SourceViewer";
import { AddForarbeteDialog, AddMenu, type AddChoice } from "./AddForarbete";
import { WorkspaceContext, type ScrollTarget } from "./Forarbeten";
import { NotesButton, NotesPanel, useNotes } from "./Notes";
import { Toc } from "./Toc";

type MobileView = "innehall" | "kalla" | "analys";

export default function WorkspacePage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const narrow = useNarrow();
  const { sizes, setSizes, reset } = usePaneSizes();
  const { ref: frame, width } = useWidth<HTMLDivElement>();

  const project = useQuery({ queryKey: ["project", id], queryFn: () => projectsApi.get(id), enabled: Number.isFinite(id) });
  const evidence = useQuery({ queryKey: ["evidence", id], queryFn: () => projectsApi.evidence(id), enabled: Number.isFinite(id) });
  const evidenceList = useMemo(() => evidence.data ?? [], [evidence.data]);

  /* ── Flikar i adressen ── */
  const tabs = useMemo(() => {
    const seen = new Set<string>();
    return params
      .getAll("flik")
      .map((k) => parseSourceKey(k))
      .filter((r): r is SourceRef => !!r && !seen.has(sourceKey(r)) && !!seen.add(sourceKey(r)));
  }, [params]);
  const activeKey = params.get("aktiv") && tabs.some((t) => sourceKey(t) === params.get("aktiv")) ? params.get("aktiv")! : tabs[0] ? sourceKey(tabs[0]) : null;
  const activeRef = tabs.find((t) => sourceKey(t) === activeKey) ?? null;
  // Andra källan sida vid sida (?bredvid=…), aldrig samma som den aktiva.
  const besideKey = params.get("bredvid") && params.get("bredvid") !== activeKey && tabs.some((t) => sourceKey(t) === params.get("bredvid")) ? params.get("bredvid")! : null;
  const besideRef = tabs.find((t) => sourceKey(t) === besideKey) ?? null;
  const [focusPane, setFocusPane] = useState<"primary" | "beside">("primary");
  const [notesOpen, setNotesOpen] = useState<Set<string>>(() => new Set());
  const [addChoice, setAddChoice] = useState<Exclude<AddChoice, { kind: "search" }> | null>(null);
  const notes = useNotes(id);

  const [scrollReq, setScrollReq] = useState<(ScrollRequest & { key: string }) | null>(() => {
    const till = params.get("till");
    const aktiv = params.get("aktiv");
    return till && aktiv ? { key: aktiv, anchor: till, nonce: 1 } : null;
  });
  const scrollTops = useRef(new Map<string, number>());
  // Avsnittet man läser i varje källa – så att läget behålls när läsytan byggs om.
  const readAnchors = useRef(new Map<string, string>());
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<"innehall" | "underlag">("innehall");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobileView, setMobileView] = useState<MobileView>(tabs.length ? "kalla" : "analys");
  const [fallback, setFallback] = useState<CitationTarget | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);

  const updateParams = useCallback(
    (fn: (p: URLSearchParams) => void) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          fn(p);
          p.delete("till");
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const openSource = useCallback(
    (ref: SourceRef, anchor?: string | null, opts: { beside?: boolean; text?: string[] | null } = {}) => {
      const key = sourceKey(ref);
      updateParams((p) => {
        if (!p.getAll("flik").includes(key)) p.append("flik", key);
        if (opts.beside && p.get("aktiv") && p.get("aktiv") !== key) p.set("bredvid", key);
        else {
          if (p.get("bredvid") === key) p.delete("bredvid");
          p.set("aktiv", key);
        }
      });
      setFocusPane(opts.beside ? "beside" : "primary");
      setActiveAnchor(null);
      if (anchor || opts.text?.length) setScrollReq({ key, anchor: anchor ?? null, text: opts.text ?? null, nonce: Date.now() });
      if (narrow) setMobileView("kalla");
      setRightOpen(true);
    },
    [updateParams, narrow],
  );
  const openBeside = useCallback((ref: SourceRef, target?: ScrollTarget) => openSource(ref, target?.anchor ?? null, { beside: !narrow, text: target?.text ?? null }), [openSource, narrow]);
  const ctx = useMemo(() => ({ projectId: id, openBeside }), [id, openBeside]);

  function closeTab(key: string) {
    updateParams((p) => {
      const rest = p.getAll("flik").filter((k) => k !== key);
      p.delete("flik");
      rest.forEach((k) => p.append("flik", k));
      if (p.get("bredvid") === key) p.delete("bredvid");
      if (p.get("aktiv") === key) {
        const i = tabs.findIndex((t) => sourceKey(t) === key);
        const next = rest[Math.min(i, rest.length - 1)];
        if (next) p.set("aktiv", next);
        else p.delete("aktiv");
      }
    });
    scrollTops.current.delete(key);
  }

  /** Klick på en hänvisning i analysen: öppna källan på rätt ställe, annars sidopanelen. */
  const openTarget = useCallback(
    async (t: CitationTarget) => {
      if (t.kind === "evidence") {
        const e = evidenceList.find((x) => x.id === t.evidenceId);
        const loc = e && evidenceLocation(e);
        if (loc) return openSource(loc.ref, loc.anchor);
        return setFallback(t);
      }
      setOpening(t.query);
      try {
        const r = await qc.fetchQuery({ queryKey: ["lagen-resolve", t.query], queryFn: () => lagenApi.resolve(t.query), staleTime: 60 * 60_000 });
        if (r.status === "found" && r.uri) openSource({ kind: "lagen", uri: stripFragment(r.uri) }, fragmentOf(r.uri));
        else setFallback(t);
      } catch {
        setFallback(t);
      } finally {
        setOpening(null);
      }
    },
    [evidenceList, openSource, qc],
  );

  const source = useSource(activeRef);
  const loaded = source.data && source.data.key === activeKey ? source.data : null;
  const beside = useSource(besideRef);
  const besideLoaded = beside.data && beside.data.key === besideKey ? beside.data : null;
  // Innehållsförteckningen följer den källa man senast arbetade i.
  const tocSource = focusPane === "beside" && besideLoaded ? besideLoaded : loaded;
  const marked = useMemo(() => new Set(tocSource ? [...evidenceByAnchor(evidenceList, tocSource.key).keys()] : []), [tocSource, evidenceList]);

  useEffect(() => setActiveAnchor(null), [activeKey, besideKey, focusPane]);

  if (!Number.isFinite(id)) return <Navigate to="/" replace />;
  if (project.isLoading) return <Spinner />;
  if (project.error || !project.data) return <ErrorNote error={project.error} onRetry={() => project.refetch()} />;
  const p = project.data;

  /* ── Paneler ── */
  const hasSource = !!activeRef;
  const leftW = leftOpen ? clamp(sizes.left, 180, Math.max(220, width * 0.35)) : 0;
  // Analysen får aldrig tränga undan källan helt: minst 360 px kvar i mitten.
  const rightW = clamp(sizes.right, 300, Math.max(320, width - leftW - 360 - 12));

  const tabBar = (
    <TabBar
      tabs={tabs}
      activeKey={activeKey}
      besideKey={besideKey}
      canBeside={!narrow}
      onSelect={(k) =>
        updateParams((p) => {
          // Väljer man källan som står bredvid byter de plats.
          if (p.get("bredvid") === k && activeKey) p.set("bredvid", activeKey);
          p.set("aktiv", k);
        })
      }
      onBeside={(k) => {
        updateParams((p) => p.set("bredvid", k));
        setFocusPane("beside");
      }}
      onClose={closeTab}
      onChoose={(c) => (c.kind === "search" ? setPicker(true) : setAddChoice(c))}
    />
  );

  const noteFor = (key: string) => notes.data?.find((n) => n.sourceKey === key);
  const toggleNotes = (key: string) =>
    setNotesOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderViewer = (ref: SourceRef | null, q: ReturnType<typeof useSource>, l: LoadedSource | null, pane: "primary" | "beside") => {
    if (!ref) return <EmptySource onOpen={() => setPicker(true)} />;
    if (q.error)
      return (
        <div className="p-6">
          <ErrorNote error={q.error} onRetry={() => q.refetch()} />
        </div>
      );
    if (!l) return <Spinner label="Hämtar rättskällan…" />;
    const req = scrollReq && scrollReq.key === l.key ? scrollReq : null;
    return (
      <div className="h-full min-h-0" onFocusCapture={() => setFocusPane(pane)} onMouseDown={() => setFocusPane(pane)}>
        <SourceViewer
          key={l.key}
          source={l}
          evidence={evidenceList}
          projectId={id}
          scrollTo={req}
          initialScrollTop={req ? undefined : scrollTops.current.get(l.key)}
          initialAnchor={req ? undefined : readAnchors.current.get(l.key)}
          onScroll={(top) => scrollTops.current.set(l.key, top)}
          onActiveAnchor={(a) => {
            readAnchors.current.set(l.key, a);
            if (pane === focusPane || (pane === "primary" && !besideLoaded)) setActiveAnchor(a);
          }}
          toolbar={<NotesButton open={notesOpen.has(l.key)} hasNote={!!noteFor(l.key)} onClick={() => toggleNotes(l.key)} />}
          footer={
            notesOpen.has(l.key) ? (
              <NotesPanel key={l.key} projectId={id} sourceKey={l.key} sourceName={l.short} note={noteFor(l.key)} onClose={() => toggleNotes(l.key)} />
            ) : undefined
          }
        />
      </div>
    );
  };

  const viewer = besideRef && !narrow ? (
    <div className="flex h-full min-h-0">
      <div style={{ flexBasis: `${Math.round(sizes.split * 100)}%` }} className={clsx("min-h-0 min-w-0 shrink grow-0", focusPane === "primary" && "ring-1 ring-inset ring-accent/20")}>
        {renderViewer(activeRef, source, loaded, "primary")}
      </div>
      <Splitter
        label="Fördelning mellan källorna"
        side="left"
        onDelta={(d) => setSizes((s) => ({ ...s, split: clamp(s.split + d / Math.max(1, width - leftW - rightW), 0.2, 0.8) }))}
        onReset={() => setSizes((s) => ({ ...s, split: 0.5 }))}
      />
      <div className={clsx("flex min-h-0 min-w-0 flex-1 flex-col border-l border-line", focusPane === "beside" && "ring-1 ring-inset ring-accent/20")}>
        <div className="flex items-center gap-2 border-b border-line bg-sunken/50 px-3 py-1 text-xs text-muted">
          <Columns2 className="size-3.5" aria-hidden /> Bredvid
          <button
            onClick={() => updateParams((p) => p.delete("bredvid"))}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface hover:text-ink"
            aria-label="Stäng sidovyn"
          >
            <X className="size-3" /> Stäng
          </button>
        </div>
        <div className="min-h-0 flex-1">{renderViewer(besideRef, beside, besideLoaded, "beside")}</div>
      </div>
    </div>
  ) : (
    renderViewer(activeRef, source, loaded, "primary")
  );

  const left = (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {(["innehall", "underlag"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setLeftTab(k)}
            className={clsx("rounded-md px-2.5 py-1 text-xs font-medium", leftTab === k ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink")}
          >
            {k === "innehall" ? "Innehåll" : `Underlag (${evidenceList.length})`}
          </button>
        ))}
        {!narrow && (
          <button onClick={() => setLeftOpen(false)} className="ml-auto rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Dölj vänsterpanelen">
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 pt-2">
        {leftTab === "innehall" ? (
          tocSource ? (
            <>
              {besideLoaded && (
                <p className="truncate px-3 pb-1.5 text-[11px] text-muted" title={tocSource.title}>
                  {tocSource.short}
                </p>
              )}
              <Toc
                key={tocSource.key}
                entries={tocSource.toc}
                active={activeAnchor}
                marked={marked}
                onJump={(anchor) => {
                  setScrollReq({ key: tocSource.key, anchor, nonce: Date.now() });
                  if (narrow) setMobileView("kalla");
                }}
              />
            </>
          ) : (
            <p className="px-3 text-xs leading-5 text-muted">
              {activeRef ? "Hämtar innehållet…" : "Öppna en rättskälla så visas dess innehållsförteckning här."}
            </p>
          )
        ) : (
          <EvidencePanel evidence={evidenceList} loading={evidence.isLoading} onOpen={openSource} />
        )}
      </div>
    </div>
  );

  const right = (
    <AnalysisPanel
      projectId={id}
      issues={(p.legalIssues ?? []).filter((i) => i.analysisCount > 0)}
      allIssues={p.legalIssues ?? []}
      evidence={evidenceList}
      selected={params.get("analys")}
      onSelect={(v) => updateParams((q) => q.set("analys", v))}
      onOpenTarget={(t) => void openTarget(t)}
      opening={opening}
      onCollapse={narrow ? undefined : () => setRightOpen(false)}
    />
  );

  return (
    <WorkspaceContext.Provider value={ctx}>
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col overflow-hidden bg-paper lg:h-dvh">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Link to={`/utredning/${id}/analys`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted hover:bg-sunken hover:text-ink">
          <ArrowLeft className="size-3.5" /> <span className="hidden sm:inline">Utredningen</span>
        </Link>
        <h1 className="min-w-0 flex-1 truncate font-serif text-lg">{p.title || "Namnlös utredning"}</h1>
        <span className="hidden text-xs text-muted md:inline">Arbetsyta</span>
        {!narrow && (
          <button onClick={reset} title="Återställ panelernas bredd" className="rounded p-1.5 text-muted hover:bg-sunken hover:text-ink" aria-label="Återställ panelernas bredd">
            <RotateCcw className="size-4" />
          </button>
        )}
      </header>

      {narrow ? (
        <>
          <nav className="grid grid-cols-3 gap-1 border-b border-line bg-surface p-1.5" aria-label="Visa">
            {(
              [
                ["innehall", "Innehåll", ListTree],
                ["kalla", "Källa", BookOpen],
                ["analys", "Analys", Scale],
              ] as const
            ).map(([k, label, Icon]) => (
              <button
                key={k}
                onClick={() => setMobileView(k)}
                aria-pressed={mobileView === k}
                className={clsx("flex items-center justify-center gap-1.5 rounded-md py-1.5 text-sm", mobileView === k ? "bg-accent-soft font-medium text-accent" : "text-muted")}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1">
            {mobileView === "innehall" && left}
            {mobileView === "kalla" && (
              <div className="flex h-full min-h-0 flex-col">
                {tabBar}
                <div className="min-h-0 flex-1 bg-surface">{viewer}</div>
              </div>
            )}
            {mobileView === "analys" && right}
          </div>
        </>
      ) : (
        <div ref={frame} className="flex min-h-0 flex-1">
          {leftOpen ? (
            <>
              <div style={{ width: leftW }} className="min-h-0 shrink-0 border-r border-line">
                {left}
              </div>
              <Splitter label="Vänsterpanelens bredd" side="left" onDelta={(d) => setSizes((s) => ({ ...s, left: clamp(s.left + d, 180, 520) }))} onReset={() => setSizes((s) => ({ ...s, left: 260 }))} />
            </>
          ) : (
            <Rail side="left" onOpen={() => setLeftOpen(true)} label="Visa innehåll och underlag" />
          )}

          {hasSource || !rightOpen ? (
            <div className="flex min-w-0 flex-1 flex-col bg-surface">
              {tabBar}
              <div className="min-h-0 flex-1">{viewer}</div>
            </div>
          ) : (
            // Ingen källa öppen: analysen tar mittenplatsen, med flikraden ovanför.
            <div className="flex min-w-0 flex-1 flex-col">
              {tabBar}
              <div className="mx-auto min-h-0 w-full max-w-4xl flex-1 border-x border-line">{right}</div>
            </div>
          )}

          {hasSource && rightOpen && (
            <>
              <Splitter
                label="Analysens bredd"
                side="right"
                onDelta={(d) => setSizes((s) => ({ ...s, right: clamp(s.right + d, 300, 1400) }))}
                onReset={() => setSizes((s) => ({ ...s, right: 440 }))}
              />
              <div style={{ width: rightW }} className="min-h-0 min-w-0 shrink-0 border-l border-line">
                {right}
              </div>
            </>
          )}
          {!rightOpen && <Rail side="right" onOpen={() => setRightOpen(true)} label="Visa analysen" />}
        </div>
      )}

      {picker && (
        <OpenSourceDialog
          evidence={evidenceList}
          onClose={() => setPicker(false)}
          onOpen={(ref, anchor) => {
            setPicker(false);
            openSource(ref, anchor);
          }}
        />
      )}
      {addChoice && (
        <AddForarbeteDialog
          choice={addChoice}
          onClose={() => setAddChoice(null)}
          onOpen={(ref, anchor) => {
            setAddChoice(null);
            openSource(ref, anchor);
          }}
        />
      )}
      {fallback && <SourcePanel target={fallback} evidence={evidenceList} projectId={id} onClose={() => setFallback(null)} />}
    </div>
    </WorkspaceContext.Provider>
  );
}

/* ─── Flikar ──────────────────────────────────────────────────────────── */

function TabBar({
  tabs,
  activeKey,
  besideKey,
  canBeside,
  onSelect,
  onBeside,
  onClose,
  onChoose,
}: {
  tabs: SourceRef[];
  activeKey: string | null;
  besideKey: string | null;
  canBeside: boolean;
  onSelect: (k: string) => void;
  onBeside: (k: string) => void;
  onClose: (k: string) => void;
  onChoose: (c: AddChoice) => void;
}) {
  return (
    <div role="tablist" aria-label="Öppna rättskällor" className="flex items-end gap-1 overflow-x-auto border-b border-line bg-sunken/50 px-2 pt-1.5">
      {tabs.map((t) => {
        const key = sourceKey(t);
        return (
          <TabChip
            key={key}
            refx={t}
            active={key === activeKey}
            beside={key === besideKey}
            onSelect={() => onSelect(key)}
            onBeside={canBeside && key !== activeKey && key !== besideKey ? () => onBeside(key) : undefined}
            onClose={() => onClose(key)}
          />
        );
      })}
      <AddMenu onChoose={onChoose} compact={tabs.length > 0} />
    </div>
  );
}

function TabChip({
  refx,
  active,
  beside,
  onSelect,
  onBeside,
  onClose,
}: {
  refx: SourceRef;
  active: boolean;
  beside: boolean;
  onSelect: () => void;
  onBeside?: () => void;
  onClose: () => void;
}) {
  // Namnet hämtas ur samma cache som läsytan (laddas först när fliken öppnas).
  const source = useSource(active || beside ? refx : null);
  const qc = useQueryClient();
  const cached = qc.getQueryData<{ short: string; title: string }>(["ws-source", sourceKey(refx)]);
  const name = source.data?.short ?? cached?.short ?? fallbackName(refx);
  return (
    <div
      role="tab"
      aria-selected={active}
      className={clsx(
        "group flex max-w-[220px] shrink-0 items-center gap-1 rounded-t-md border border-b-0 pl-2.5 pr-1 text-xs",
        active
          ? "-mb-px border-line bg-surface py-1.5 font-medium text-ink"
          : beside
            ? "-mb-px border-dashed border-line bg-surface/80 py-1.5 text-ink"
            : "border-transparent py-1 text-muted hover:bg-surface/70 hover:text-ink",
      )}
      title={source.data?.title ?? cached?.title}
    >
      <button onClick={onSelect} onAuxClick={(e) => e.button === 1 && onClose()} className="min-w-0 truncate">
        {refx.kind === "lagen" ? <span className="mr-1 text-[10px] uppercase tracking-wide text-muted">lagen.nu</span> : null}
        {refx.kind === "riksdagen" ? <span className="mr-1 text-[10px] uppercase tracking-wide text-muted">riksdagen</span> : null}
        {name}
      </button>
      {beside && <Columns2 className="size-3 text-muted" aria-label="Visas bredvid" />}
      {onBeside && (
        <button onClick={onBeside} aria-label={`Visa ${name} bredvid`} title="Visa bredvid" className="rounded p-0.5 text-muted opacity-0 hover:bg-sunken hover:text-ink group-hover:opacity-100">
          <Columns2 className="size-3" />
        </button>
      )}
      <button onClick={onClose} aria-label={`Stäng ${name}`} className="rounded p-0.5 text-muted opacity-60 hover:bg-sunken hover:text-ink group-hover:opacity-100">
        <X className="size-3" />
      </button>
    </div>
  );
}

function fallbackName(ref: SourceRef): string {
  if (ref.kind === "doc") return `Dokument ${ref.documentId}`;
  if (ref.kind === "riksdagen") return ref.dokId;
  return ref.uri.replace("https://lagen.nu/", "");
}

function Rail({ side, onOpen, label }: { side: "left" | "right"; onOpen: () => void; label: string }) {
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  return (
    <button
      onClick={onOpen}
      aria-label={label}
      title={label}
      className={clsx("flex w-9 shrink-0 items-start justify-center bg-surface pt-3 text-muted hover:bg-sunken hover:text-ink", side === "left" ? "border-r border-line" : "border-l border-line")}
    >
      <Icon className="size-4" />
    </button>
  );
}

function EmptySource({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <BookOpen className="mx-auto size-8 text-muted" aria-hidden />
        <p className="mt-3 font-medium">Ingen rättskälla öppen</p>
        <p className="mt-1 text-sm text-muted">Klicka på en hänvisning i analysen, på en källa i underlaget eller öppna en rättskälla här.</p>
        <Button className="mt-4" size="sm" variant="secondary" icon={<Plus className="size-3.5" />} onClick={onOpen}>
          Öppna rättskälla
        </Button>
      </div>
    </div>
  );
}

/* ─── Underlaget ──────────────────────────────────────────────────────── */

function EvidencePanel({ evidence, loading, onOpen }: { evidence: ExpandedEvidenceDto[]; loading: boolean; onOpen: (ref: SourceRef, anchor?: string | null) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; items: ExpandedEvidenceDto[] }>();
    for (const e of evidence) {
      const loc = evidenceLocation(e);
      const key = loc ? sourceKey(loc.ref) : "egna";
      const name = e.documentTitle ?? (loc?.ref.kind === "lagen" ? loc.ref.uri.replace("https://", "") : loc?.ref.kind === "riksdagen" ? `riksdagen.se ${loc.ref.dokId}` : "Egna källor");
      const g = m.get(key) ?? { name, items: [] };
      g.items.push(e);
      m.set(key, g);
    }
    return [...m.values()];
  }, [evidence]);

  if (loading) return <Spinner />;
  if (evidence.length === 0) return <p className="px-3 text-xs leading-5 text-muted">Inga rättskällor i underlaget ännu. Markera text i en källa för att lägga till.</p>;

  return (
    <div className="h-full overflow-y-auto px-2 pb-4">
      {groups.map((g) => (
        <section key={g.name} className="mb-3">
          <h3 className="truncate px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted" title={g.name}>
            {g.name}
          </h3>
          <ul className="space-y-1">
            {g.items.map((e) => {
              const loc = evidenceLocation(e);
              return (
                <li key={e.id} className="rounded-md px-1.5 py-1 hover:bg-sunken/60">
                  <button
                    disabled={!loc}
                    onClick={() => loc && onOpen(loc.ref, loc.anchor)}
                    className="text-left text-[13px] font-medium leading-snug text-ink hover:text-accent disabled:hover:text-ink"
                  >
                    {e.displayLabel || e.documentTitle || "Källa"}
                  </button>
                  {e.content && <ExpandableText text={e.content} lines={2} className="mt-0.5 text-xs leading-5 text-muted" />}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ─── Analysen ────────────────────────────────────────────────────────── */

function AnalysisPanel({
  projectId,
  issues,
  allIssues,
  evidence,
  selected,
  onSelect,
  onOpenTarget,
  opening,
  onCollapse,
}: {
  projectId: number;
  issues: { id: number; text: string | null }[];
  allIssues: { id: number }[];
  evidence: ExpandedEvidenceDto[];
  selected: string | null;
  onSelect: (v: string) => void;
  onOpenTarget: (t: CitationTarget) => void;
  opening: string | null;
  onCollapse?: () => void;
}) {
  const analyses = useQuery({ queryKey: ["analyses", projectId], queryFn: () => projectsApi.analyses(projectId) });
  const issueQueries = useQueries({
    queries: issues.map((i) => ({ queryKey: ["issueAnalyses", projectId, i.id], queryFn: () => projectsApi.issueAnalyses(projectId, i.id) })),
  });
  const latest = <T extends { createdAt: string }>(list?: T[]) => [...(list ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const overall = latest<ProjectAnalysisDto>(analyses.data);

  const options: { value: string; label: string; analysis?: { outputContent: string | null; createdAt: string } }[] = [];
  if (overall) options.push({ value: "samlad", label: "Samlad analys", analysis: overall });
  issues.forEach((i, n) => {
    const a = latest<LegalIssueAnalysisDto>(issueQueries[n]?.data);
    const num = allIssues.findIndex((x) => x.id === i.id) + 1;
    options.push({ value: `fraga-${i.id}`, label: `F${num}: ${i.text ?? "Rättsfråga"}`, analysis: a });
  });
  const current = options.find((o) => o.value === selected) ?? options[0];
  const loading = analyses.isLoading || issueQueries.some((q) => q.isLoading);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <FileText className="size-4 shrink-0 text-muted" aria-hidden />
        {options.length > 1 ? (
          <select
            value={current?.value}
            onChange={(e) => onSelect(e.target.value)}
            aria-label="Välj analys"
            className="h-8 min-w-0 flex-1 truncate rounded-md border border-line bg-surface px-2 text-sm"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label.length > 90 ? `${o.label.slice(0, 88)}…` : o.label}
              </option>
            ))}
          </select>
        ) : (
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{current?.label ?? "Analys"}</p>
        )}
        {opening && <Loader2 className="size-4 animate-spin text-muted" aria-label={`Öppnar ${opening}`} />}
        {onCollapse && (
          <button onClick={onCollapse} className="rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Dölj analysen">
            <PanelRightClose className="size-4" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {loading && !current?.analysis && <Spinner />}
        {!loading && options.length === 0 && (
          <div className="py-10 text-center text-sm text-muted">
            <p>Ingen analys ännu.</p>
            <Link to={`/utredning/${projectId}/delanalyser`} className="mt-2 inline-flex items-center gap-1 text-accent hover:underline">
              Gör en delanalys <ExternalLink className="size-3.5" />
            </Link>
          </div>
        )}
        {current?.analysis && (
          <>
            <p className="mb-3 text-xs text-muted">
              {formatDateTime(current.analysis.createdAt)} · Klicka på en hänvisning för att öppna källan.
            </p>
            <CitedMarkdown key={current.value} markdown={current.analysis.outputContent ?? ""} evidence={evidence} projectId={projectId} onOpenTarget={onOpenTarget} complement={{}} />
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Öppna rättskälla ────────────────────────────────────────────────── */

function OpenSourceDialog({ evidence, onClose, onOpen }: { evidence: ExpandedEvidenceDto[]; onClose: () => void; onOpen: (ref: SourceRef, anchor?: string | null) => void }) {
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const corpus = useQuery({ queryKey: ["documents", q, "", false, 1], queryFn: () => documentsApi.list({ search: q, page: 1, pageSize: 8 }), enabled: q.length >= 2 });
  const resolved = useQuery({ queryKey: ["lagen-resolve", q], queryFn: () => lagenApi.resolve(q), enabled: q.length >= 2, staleTime: 60 * 60_000, retry: 0 });
  const search = useQuery({ queryKey: ["lagen-search", q], queryFn: () => lagenApi.search(q, 6), enabled: q.length >= 2, staleTime: 60 * 60_000, retry: 0 });

  const inUnderlag = useMemo(() => {
    const m = new Map<string, { ref: SourceRef; name: string }>();
    for (const e of evidence) {
      const loc = evidenceLocation(e);
      if (!loc) continue;
      const k = sourceKey(loc.ref);
      if (!m.has(k)) m.set(k, { ref: loc.ref, name: e.documentTitle ?? e.displayLabel ?? loc.ref.kind });
    }
    return [...m.values()];
  }, [evidence]);

  function submit(e: FormEvent) {
    e.preventDefault();
    setQ(draft.trim().slice(0, 300));
  }

  const r = resolved.data;
  const lagenHits = (search.data?.results ?? []).filter((h) => !r?.uri || stripFragment(h.uri) !== stripFragment(r.uri));

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink/30 p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label="Öppna rättskälla" onClick={onClose}>
      <div className="w-full max-w-xl rounded-lg border border-line bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
        <form onSubmit={submit} className="flex gap-2 border-b border-line p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="T.ex. utlänningslagen, 12 kap. 3 § ÄktB, prop. 2004/05:170" className="pl-9" aria-label="Sök rättskälla" />
          </div>
          <Button type="submit" disabled={draft.trim().length < 2}>
            Sök
          </Button>
        </form>
        <div className="max-h-[60vh] overflow-y-auto p-2 text-sm">
          {!q && inUnderlag.length > 0 && (
            <Group title="I underlaget">
              {inUnderlag.map((s) => (
                <Hit key={sourceKey(s.ref)} title={s.name} onClick={() => onOpen(s.ref)} />
              ))}
            </Group>
          )}
          {!q && <p className="px-2 py-3 text-xs text-muted">Sök i Lawlas rättskällor och på lagen.nu. En hänvisning med paragraf öppnar källan på rätt ställe.</p>}
          {q && (
            <>
              <Group title="lagen.nu" loading={resolved.isLoading || search.isLoading}>
                {r?.status === "found" && r.uri && (
                  <Hit
                    title={[r.pinLabel, r.title].filter(Boolean).join(" ") || r.uri}
                    sub={[r.kindLabel, r.identifier].filter(Boolean).join(" · ")}
                    onClick={() => onOpen({ kind: "lagen", uri: stripFragment(r.uri!) }, fragmentOf(r.uri!))}
                  />
                )}
                {r?.status === "invalid" && <p className="px-2 py-1 text-xs text-danger">lagen.nu: hänvisningen finns inte.</p>}
                {lagenHits.map((h) => (
                  <Hit key={h.uri} title={h.title ?? h.identifier ?? h.uri} sub={[h.kindLabel, h.identifier].filter(Boolean).join(" · ")} onClick={() => onOpen({ kind: "lagen", uri: stripFragment(h.uri) }, fragmentOf(h.uri))} />
                ))}
                {!resolved.isLoading && !search.isLoading && r?.status !== "found" && lagenHits.length === 0 && <p className="px-2 py-1 text-xs text-muted">Inga träffar.</p>}
              </Group>
              <Group title="Lawlas rättskällor" loading={corpus.isLoading}>
                {corpus.data?.map((d) => (
                  <Hit key={d.id} title={d.title || "Utan titel"} sub={[d.documentType, d.canonicalId].filter(Boolean).join(" · ")} onClick={() => onOpen({ kind: "doc", documentId: d.id })} />
                ))}
                {corpus.data?.length === 0 && <p className="px-2 py-1 text-xs text-muted">Inga träffar.</p>}
              </Group>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Group({ title, loading, children }: { title: string; loading?: boolean; children: React.ReactNode }) {
  return (
    <section className="mb-2">
      <h3 className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {title} {loading && <Loader2 className="size-3 animate-spin" />}
      </h3>
      <ul>{children}</ul>
    </section>
  );
}

function Hit({ title, sub, onClick }: { title: string; sub?: string; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-sunken">
        <span className="block truncate font-medium">{title}</span>
        {sub && <span className="block truncate text-xs text-muted">{sub}</span>}
      </button>
    </li>
  );
}
