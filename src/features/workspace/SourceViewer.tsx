import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BookmarkCheck, BookPlus, ChevronDown, ChevronUp, ExternalLink, Search, X } from "lucide-react";
import { projectsApi } from "@/api/client";
import type { AddEvidenceRequest, ExpandedEvidenceDto } from "@/api/types";
import { Button, Input, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { excerpt, findLagrum, lagrumText, parseLagrumQuery, resolveBareNumber, selectionLabel, type SourceBlock } from "../../../shared/sourceDoc";
import { evidenceByAnchor, findPassage, searchBlocks, segment, type LoadedSource, type Range } from "./sources";

/** Längsta markering som kan sparas som ett textställe. */
const MAX_SELECTION = 20_000;

export interface ScrollRequest {
  anchor: string;
  /** Ändras för varje begäran, så att samma ställe kan visas igen. */
  nonce: number;
}

interface Pending {
  first: SourceBlock;
  last: SourceBlock;
  text: string;
  label: string;
  /** Position relativt läsytan. */
  top: number;
  left: number;
}

export function SourceViewer({
  source,
  evidence,
  projectId,
  scrollTo,
  initialScrollTop,
  onScroll,
  onActiveAnchor,
}: {
  source: LoadedSource;
  evidence: ExpandedEvidenceDto[];
  projectId: number;
  scrollTo: ScrollRequest | null;
  initialScrollTop?: number;
  onScroll?: (top: number) => void;
  onActiveAnchor?: (anchor: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const byAnchor = useMemo(() => evidenceByAnchor(evidence, source.key), [evidence, source.key]);
  // "7 18", "7:18", "7 kap. 18 §", "36 §" … går direkt till lagrummet; annars fritextsökning.
  const lagrum = useMemo(() => {
    const parsed = parseLagrumQuery(query);
    if (!parsed) return null;
    const q = resolveBareNumber(source.blocks, parsed, query);
    return { text: lagrumText(q), block: findLagrum(source.blocks, q) };
  }, [query, source.blocks]);
  const lagrumHit = lagrum?.block ?? null;
  const [jump, setJump] = useState(0);
  const matches = useMemo(() => (lagrumHit ? [] : searchBlocks(source.blocks, query)), [source.blocks, query, lagrumHit]);
  const blockIndex = useMemo(() => new Map(source.blocks.map((b, i) => [b.anchor, i])), [source.blocks]);
  const unplaced = byAnchor.get("") ?? [];

  /* ── Rulla till ställe (hänvisning, innehållsförteckning) ── */
  useLayoutEffect(() => {
    if (initialScrollTop && scroller.current) scroller.current.scrollTop = initialScrollTop;
    // bara vid montering
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!scrollTo) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(scrollTo.anchor)}"]`);
    if (!el) return;
    scrollWithin(scroller.current!, el, "start");
    setFlash(scrollTo.anchor);
    const t = setTimeout(() => setFlash(null), 2200);
    return () => clearTimeout(t);
  }, [scrollTo, source.key]);

  /* ── Sökning ── */
  useEffect(() => setCurrent(0), [query]);
  useEffect(() => {
    if (!lagrumHit) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(lagrumHit.anchor)}"]`);
    if (el) scrollWithin(scroller.current!, el, "start");
  }, [lagrumHit, jump]);
  useEffect(() => {
    if (matches.length === 0) return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-match="${current}"]`);
    if (el) scrollWithin(scroller.current!, el, "center");
  }, [current, matches]);
  const step = (d: number) => matches.length && setCurrent((c) => (c + d + matches.length) % matches.length);
  function searchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (lagrumHit) setJump((n) => n + 1);
      else step(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") setQuery("");
  }
  // Ctrl/⌘+F i läsytan söker i källan i stället för på hela sidan.
  useEffect(() => {
    const el = scroller.current?.parentElement;
    if (!el) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, []);

  /* ── Aktivt avsnitt (för innehållsförteckningen) ── */
  const reportScroll = useRef<number | null>(null);
  function scrolled() {
    if (reportScroll.current != null) return;
    reportScroll.current = requestAnimationFrame(() => {
      reportScroll.current = null;
      const root = scroller.current;
      if (!root) return;
      onScroll?.(root.scrollTop);
      const top = root.getBoundingClientRect().top + 24;
      const els = root.querySelectorAll<HTMLElement>("[data-anchor]");
      let active: string | null = null;
      for (const el of els) {
        if (el.getBoundingClientRect().top > top) break;
        active = el.dataset.anchor ?? null;
      }
      if (active) onActiveAnchor?.(active);
    });
  }

  /* ── Markering → lägg till i underlaget ── */
  const readSelection = useCallback(() => {
    const root = scroller.current;
    const sel = window.getSelection();
    if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return setPending(null);
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const text = sel.toString().replace(/\u00a0/g, " ").trim();
    if (text.length < 2) return setPending(null);
    const blockOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-anchor]");
    const a = blockOf(range.startContainer);
    const b = blockOf(range.endContainer);
    const ia = a ? blockIndex.get(a.dataset.anchor!) : undefined;
    const ib = b ? blockIndex.get(b.dataset.anchor!) : undefined;
    if (ia == null || ib == null) return;
    // Rubriker räknas inte som lagrum – ta närmaste textblock.
    const first = nearestText(source.blocks, Math.min(ia, ib), 1);
    const last = nearestText(source.blocks, Math.max(ia, ib), -1) ?? first;
    if (!first || !last) return;
    const rect = range.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    setPending({
      first,
      last,
      text: text.slice(0, MAX_SELECTION),
      label: selectionLabel(first, last, { title: source.title, identifier: source.identifier }),
      top: rect.bottom - box.top + root.scrollTop + 8,
      left: Math.max(8, Math.min(rect.left - box.left, box.width - 380)),
    });
  }, [blockIndex, source.blocks, source.title, source.identifier]);

  function addWhole(block: SourceBlock, target: HTMLElement) {
    const root = scroller.current!;
    const rect = target.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    setPending({
      first: block,
      last: block,
      text: block.text,
      label: selectionLabel(block, block, { title: source.title, identifier: source.identifier }),
      top: rect.bottom - box.top + root.scrollTop + 4,
      left: Math.max(8, Math.min(rect.left - box.left - 300, box.width - 380)),
    });
  }

  const matchesByAnchor = useMemo(() => {
    const m = new Map<string, { start: number; end: number; index: number }[]>();
    matches.forEach((x, index) => m.set(x.anchor, [...(m.get(x.anchor) ?? []), { start: x.start, end: x.end, index }]));
    return m;
  }, [matches]);

  return (
    <div className="flex h-full min-h-0 flex-col" tabIndex={-1}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-[17px] leading-tight" title={source.title}>
            {source.title}
          </p>
          <p className="truncate text-xs text-muted">
            {[source.typeLabel, source.identifier].filter(Boolean).join(" · ")}
            {source.externalUrl && (
              <a href={source.externalUrl} target="_blank" rel="noreferrer noopener" className="ml-2 inline-flex items-center gap-0.5 text-accent hover:underline">
                {source.ref.kind === "lagen" ? "lagen.nu" : "Originalkälla"} <ExternalLink className="size-3" />
              </a>
            )}
          </p>
        </div>
        <div className="flex w-full items-center gap-1 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              ref={searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={searchKey}
              placeholder={`Sök i ${source.short} eller gå till t.ex. 7 18`}
              aria-label={`Sök i ${source.title}, eller ange kapitel och paragraf, t.ex. 7 18`}
              title="Fritext, eller lagrum: 7 18 = 7 kap. 18 §, 7 kap = kapitlet, 36 § = paragrafen"
              className={clsx("h-8 pl-8", lagrum ? "pr-28" : "pr-16")}
            />
            {(lagrum || query.trim().length >= 2) && (
              <span
                className={clsx("absolute right-2 top-1/2 max-w-[7.5rem] -translate-y-1/2 truncate text-xs tabular-nums", lagrumHit ? "font-medium text-accent" : "text-muted")}
                aria-live="polite"
              >
                {lagrumHit
                  ? `→ ${lagrum!.text}`
                  : matches.length
                    ? `${current + 1} av ${matches.length >= 2000 ? "2000+" : matches.length}`
                    : lagrum
                      ? `${lagrum.text} saknas`
                      : "0 träffar"}
              </span>
            )}
          </div>
          <button onClick={() => step(-1)} disabled={!matches.length} aria-label="Föregående träff" className="rounded p-1.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-40">
            <ChevronUp className="size-4" />
          </button>
          <button onClick={() => step(1)} disabled={!matches.length} aria-label="Nästa träff" className="rounded p-1.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-40">
            <ChevronDown className="size-4" />
          </button>
        </div>
      </div>

      <div
        ref={scroller}
        onScroll={scrolled}
        onMouseUp={() => setTimeout(readSelection, 0)}
        onKeyUp={(e) => e.shiftKey && readSelection()}
        onTouchEnd={() => setTimeout(readSelection, 50)}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <article className="mx-auto max-w-[72ch] px-5 pb-32 pt-5 sm:px-8">
          {source.truncated && (
            <p className="mb-4 rounded-md bg-sunken p-2.5 text-xs text-muted">Dokumentet är mycket långt och visas förkortat. Öppna hela på lagen.nu.</p>
          )}
          {unplaced.length > 0 && (
            <p className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <BookmarkCheck className="size-3.5 text-ok" aria-hidden /> I underlaget från källan:
              {unplaced.map((e) => (
                <span key={e.id} className="rounded bg-ok/10 px-1.5 py-0.5 text-ok">
                  {e.displayLabel || "Källa"}
                </span>
              ))}
            </p>
          )}
          {source.blocks.length === 0 && <p className="text-sm text-muted">Källan har ingen text att visa.</p>}
          {source.blocks.map((b) => (
            <Block
              key={b.anchor}
              block={b}
              evidence={byAnchor.get(b.anchor)}
              searchHits={matchesByAnchor.get(b.anchor)}
              current={current}
              flash={flash === b.anchor || lagrumHit?.anchor === b.anchor}
              pendingText={pending && (pending.first.anchor === b.anchor || pending.last.anchor === b.anchor) ? pending.text : undefined}
              onAdd={addWhole}
            />
          ))}
        </article>

        {pending && (
          <AddPassage
            key={`${pending.first.anchor}-${pending.text.length}`}
            pending={pending}
            source={source}
            projectId={projectId}
            onClose={() => {
              setPending(null);
              window.getSelection()?.removeAllRanges();
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Rullar bara läsytan (inte sidan). scrollIntoView rullar även föräldrar och fönstret, vilket
 * flyttar hela arbetsytan.
 */
function scrollWithin(root: HTMLElement, el: HTMLElement, where: "start" | "center") {
  const offset = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
  const top = where === "start" ? offset - 12 : offset - root.clientHeight / 2 + el.offsetHeight / 2;
  root.scrollTo({ top: Math.max(0, top), behavior: where === "start" ? "auto" : "smooth" });
}

function nearestText(blocks: SourceBlock[], from: number, dir: 1 | -1): SourceBlock | null {
  for (let i = from; i >= 0 && i < blocks.length; i += dir) if (blocks[i]!.kind === "text") return blocks[i]!;
  return null;
}

/* ─── Block ───────────────────────────────────────────────────────────── */

const Block = memo(function Block({
  block,
  evidence,
  searchHits,
  current,
  flash,
  pendingText,
  onAdd,
}: {
  block: SourceBlock;
  /** Markering som håller på att läggas till – visas kvar medan rutan är öppen. */
  pendingText?: string;
  evidence?: ExpandedEvidenceDto[];
  searchHits?: { start: number; end: number; index: number }[];
  current: number;
  flash: boolean;
  onAdd: (b: SourceBlock, el: HTMLElement) => void;
}) {
  if (block.kind === "heading") {
    const size = block.level <= 2 ? "text-xl mt-10" : block.level === 3 ? "text-lg mt-7" : "text-base mt-5";
    return (
      <h3 data-anchor={block.anchor} className={clsx("mb-2 scroll-mt-4 font-serif leading-snug", size, flash && "rounded bg-accent-soft")}>
        {renderText(block.text, searchHits, current, [])}
      </h3>
    );
  }

  const evRanges: Range[] = [];
  for (const e of evidence ?? []) {
    const r = findPassage(block.text, e.content);
    // Hela stycket i underlaget markeras med kant, inte med understrykning av all text.
    if (r && r[1] - r[0] < block.text.length * 0.9) evRanges.push({ start: r[0], end: r[1], kind: "evidence" });
  }
  if (pendingText) {
    const r = findPassage(block.text, pendingText) ?? findPassage(block.text, pendingText.split(/\n/)[0]);
    if (r) evRanges.push({ start: r[0], end: r[1], kind: "pending" });
  }
  const inEvidence = (evidence?.length ?? 0) > 0;

  return (
    <section
      data-anchor={block.anchor}
      className={clsx(
        "group relative -mx-3 my-1 scroll-mt-4 rounded-md border-l-2 px-3 py-1.5 transition-colors",
        inEvidence ? "border-ok/60" : "border-transparent",
        flash && "bg-accent-soft",
      )}
    >
      {inEvidence && (
        <p className="mb-1 flex flex-wrap gap-1">
          {evidence!.map((e) => (
            <span key={e.id} className="inline-flex items-center gap-1 rounded bg-ok/10 px-1.5 py-0.5 text-[11px] font-medium text-ok" title="Finns i utredningens underlag">
              <BookmarkCheck className="size-3" aria-hidden /> {e.displayLabel || "I underlaget"}
            </span>
          ))}
        </p>
      )}
      <p className="whitespace-pre-line text-[15px] leading-7">{renderText(block.text, searchHits, current, evRanges)}</p>
      <button
        onClick={(e) => onAdd(block, e.currentTarget)}
        className="absolute -right-1 top-1 rounded-md border border-line bg-surface p-1 text-muted opacity-0 shadow-sm transition hover:text-accent focus:opacity-100 group-hover:opacity-100 print:hidden"
        aria-label={`Lägg till ${block.label ?? "stycket"} i underlaget`}
        title={`Lägg till ${block.label ?? "stycket"} i underlaget`}
      >
        <BookPlus className="size-3.5" />
      </button>
    </section>
  );
});

function renderText(text: string, hits: { start: number; end: number; index: number }[] | undefined, current: number, extra: Range[]): ReactNode {
  const ranges: Range[] = [...extra];
  for (const h of hits ?? []) ranges.push({ start: h.start, end: h.end, kind: h.index === current ? "current" : "search" });
  if (ranges.length === 0) return text;
  let pos = 0;
  return segment(text, ranges).map((s, i) => {
    const start = pos;
    pos += s.text.length;
    if (s.kinds.size === 0) return s.text;
    const hit = hits?.find((h) => h.start <= start && h.end >= pos);
    const cls = s.kinds.has("pending") && !s.kinds.has("current") && !s.kinds.has("search")
      ? "bg-accent/20 text-ink"
      : s.kinds.has("current")
      ? "rounded-sm bg-warn/40 text-ink outline outline-1 outline-warn"
      : s.kinds.has("search")
        ? "rounded-sm bg-warn/20 text-ink"
        : "bg-ok/15 text-ink decoration-ok/50 underline decoration-2 underline-offset-4";
    return (
      <mark key={i} data-match={hit && (s.kinds.has("search") || s.kinds.has("current")) ? hit.index : undefined} className={cls}>
        {s.text}
      </mark>
    );
  });
}

/* ─── Lägg till markering ─────────────────────────────────────────────── */

function AddPassage({ pending, source, projectId, onClose }: { pending: Pending; source: LoadedSource; projectId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState(pending.label);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const add = useMutation({
    mutationFn: () => projectsApi.addEvidence(projectId, buildRequest(source, pending, label.trim(), comment.trim())),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["evidence", projectId] });
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast(`${label.trim()} är tillagd i underlaget.`);
      onClose();
    },
    onError: (e) => toast(e.message, "error"),
  });

  const short = excerpt(pending.text, 220);
  const long = short !== pending.text.replace(/\s+/g, " ").trim();

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Lägg till i underlaget"
      style={{ top: pending.top, left: pending.left }}
      className="absolute z-20 w-[min(372px,calc(100%-16px))] rounded-lg border border-line bg-surface p-3 text-sm shadow-xl"
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Lägg till i underlaget</p>
        <button onClick={onClose} aria-label="Stäng" className="rounded p-0.5 text-muted hover:bg-sunken hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <label className="sr-only" htmlFor="ws-label">
        Hänvisning
      </label>
      <Input id="ws-label" value={label} onChange={(e) => setLabel(e.target.value)} className="h-9 font-medium" maxLength={300} />
      <blockquote className="mt-2 border-l-2 border-accent/40 pl-2.5 text-[13px] leading-5 text-ink/85">
        {expanded ? <span className="block max-h-60 overflow-y-auto whitespace-pre-line">{pending.text}</span> : short}
        {long && (
          <button onClick={() => setExpanded((v) => !v)} className="ml-1 text-xs text-accent hover:underline">
            {expanded ? "Visa mindre" : `Visa hela (${pending.text.length.toLocaleString("sv-SE")} tecken)`}
          </button>
        )}
      </blockquote>
      {showComment ? (
        <Textarea
          className="mt-2"
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Varför är stycket relevant? (valfritt)"
          aria-label="Kommentar"
        />
      ) : (
        <button onClick={() => setShowComment(true)} className="mt-2 text-xs text-muted underline decoration-dotted hover:text-ink">
          Lägg till kommentar
        </button>
      )}
      <div className="mt-3 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Avbryt
        </Button>
        <Button size="sm" icon={<BookPlus className="size-3.5" />} loading={add.isPending} disabled={!label.trim()} onClick={() => add.mutate()}>
          Lägg till
        </Button>
      </div>
    </div>
  );
}

/** Rättskälla för en markering. Korpus: kopplad till avsnittet. lagen.nu: adressen sparas i kommentaren. */
export function buildRequest(source: LoadedSource, p: { first: SourceBlock; text: string }, label: string, comment: string): AddEvidenceRequest {
  if (source.ref.kind === "doc") {
    return { documentId: source.ref.documentId, chunkId: p.first.chunkId ?? null, content: p.text, displayLabel: label, annotation: comment || null };
  }
  const date = new Date().toISOString().slice(0, 10);
  const origin = `Källa: lagen.nu ${source.ref.uri}#${p.first.anchor} (${date}).`;
  return { documentId: null, chunkId: null, content: p.text, displayLabel: label, annotation: comment ? `${comment}\n\n${origin}` : origin };
}
