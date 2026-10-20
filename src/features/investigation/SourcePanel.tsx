import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookOpen, ExternalLink, Search, X } from "lucide-react";
import { documentsApi } from "@/api/client";
import type { ExpandedEvidenceDto } from "@/api/types";
import { Markdown, Spinner } from "@/components/ui";
import { linkifyCitations, type CitationReport, type CitationTarget } from "./citations";
import { splitUncertainties } from "./uncertainties";
import { UncertaintySection, type ComplementOptions } from "./UncertaintyFields";
import { LAGEN_STATUS_TEXT, LagenCheck, LagenStatusIcon, lagenSummary, useLagenVerify } from "./lagen";

/**
 * Visar AI-text där hänvisningar är klickbara och leder till underlaget.
 * Under texten sammanfattas vilka källor som används, vilka som inte används
 * och vilka hänvisningar som inte finns i underlaget (de ska juristen kontrollera).
 */
export function CitedMarkdown({
  markdown,
  evidence,
  projectId,
  summary = true,
  complement,
  onOpenTarget,
}: {
  markdown: string;
  evidence: ExpandedEvidenceDto[];
  projectId: number;
  summary?: boolean;
  /** Ger fält under varje punkt i analysens osäkerhetsavsnitt, för att komplettera med omständigheter. */
  complement?: ComplementOptions;
  /** Tar över klick på hänvisningar (arbetsytan öppnar källan i en flik i stället för sidopanelen). */
  onOpenTarget?: (t: CitationTarget) => void;
}) {
  const { markdown: linked, report } = useMemo(() => linkifyCitations(markdown, evidence), [markdown, evidence]);
  const hasComplement = !!complement;
  const split = useMemo(() => (hasComplement ? splitUncertainties(linked) : null), [hasComplement, linked]);
  const [ownTarget, setOwnTarget] = useState<CitationTarget | null>(null);
  const setTarget = onOpenTarget ?? setOwnTarget;
  const target = onOpenTarget ? null : ownTarget;

  return (
    <>
      {split && complement ? (
        <>
          {split.before.trim() && <Markdown onCitation={setTarget}>{split.before}</Markdown>}
          <UncertaintySection key={markdown} split={split} projectId={projectId} onCitation={setTarget} options={complement} />
          {split.after.trim() && <Markdown onCitation={setTarget}>{split.after}</Markdown>}
        </>
      ) : (
        <Markdown onCitation={setTarget}>{linked}</Markdown>
      )}
      {summary && <CitationSummary report={report} onOpen={setTarget} />}
      {target && <SourcePanel target={target} evidence={evidence} projectId={projectId} onClose={() => setOwnTarget(null)} />}
    </>
  );
}

export function CitationSummary({ report, onOpen }: { report: CitationReport; onOpen: (t: CitationTarget) => void }) {
  // Hänvisningar som saknas i underlaget kontrolleras automatiskt mot lagen.nu.
  const lagen = useLagenVerify(report.unmatched);
  const lagenLine = lagenSummary(lagen.data, report.unmatched);
  if (report.citations.length === 0 && report.unused.length === 0) return null;
  return (
    <div className="mt-6 space-y-3 border-t border-line pt-4 text-sm">
      {report.used.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Källor som analysen bygger på</p>
          <ul className="flex flex-wrap gap-1.5">
            {report.used.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => onOpen({ kind: "evidence", evidenceId: e.id })}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
                >
                  <BookOpen className="size-3" aria-hidden /> {e.displayLabel || e.documentTitle || `Källa ${e.id}`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.unmatched.length > 0 && (
        <div className="rounded-md border border-danger/30 bg-danger/5 p-3">
          <p className="mb-1 flex items-center gap-1.5 font-medium text-danger">
            <AlertTriangle className="size-4" aria-hidden />
            {report.unmatched.length === 1 ? "1 hänvisning finns inte i underlaget" : `${report.unmatched.length} hänvisningar finns inte i underlaget`}
          </p>
          <p className="mb-2 text-xs text-muted">
            Lawla kan hänvisa till källor som inte är kontrollerade. Hänvisningarna kontrolleras mot lagen.nu – klicka för att se textstället och lägga
            till det som rättskälla.
            {lagen.isLoading && " Kontrollerar…"}
            {lagenLine && <span className="mt-1 block font-medium text-ink">lagen.nu: {lagenLine}.</span>}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {report.unmatched.map((text) => (
              <li key={text}>
                <button
                  onClick={() => onOpen({ kind: "search", query: text })}
                  title={lagen.data?.get(text) ? LAGEN_STATUS_TEXT[lagen.data.get(text)!.status] : undefined}
                  className="inline-flex items-center gap-1 rounded-full border border-danger/40 px-2.5 py-1 text-xs text-danger hover:bg-danger/10"
                >
                  <LagenStatusIcon status={lagen.data?.get(text)?.status} loading={lagen.isLoading} className="size-3" />
                  {text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.unused.length > 0 && report.citations.length > 0 && (
        <p className="text-xs text-muted">
          {report.unused.length === 1 ? "1 källa i underlaget" : `${report.unused.length} källor i underlaget`} används inte i analysen:{" "}
          {report.unused.map((e, i) => (
            <span key={e.id}>
              {i > 0 && ", "}
              <button onClick={() => onOpen({ kind: "evidence", evidenceId: e.id })} className="underline decoration-dotted hover:text-ink">
                {e.displayLabel || e.documentTitle || `Källa ${e.id}`}
              </button>
            </span>
          ))}
          .
        </p>
      )}
    </div>
  );
}

/** Sidopanel som visar textstället för en hänvisning utan att lämna analysen. */
export function SourcePanel({
  target,
  evidence,
  projectId,
  onClose,
}: {
  target: CitationTarget;
  evidence: ExpandedEvidenceDto[];
  projectId: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const item = target.kind === "evidence" ? evidence.find((e) => e.id === target.evidenceId) : undefined;

  return (
    <div className="fixed inset-0 z-40 flex justify-end print:hidden" role="dialog" aria-modal="true" aria-label="Rättskälla">
      <button className="flex-1 bg-ink/30" onClick={onClose} aria-label="Stäng" />
      <aside className="flex h-full w-full max-w-lg flex-col border-l border-line bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{target.kind === "evidence" ? "Textställe i underlaget" : "Hänvisning som saknas i underlaget"}</p>
            <h2 className="mt-1 font-serif text-lg leading-snug">
              {target.kind === "evidence" ? item?.displayLabel || item?.documentTitle || "Källa" : target.query}
            </h2>
            {item?.documentTitle && item.displayLabel && <p className="text-sm text-muted">{item.documentTitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Stäng" className="rounded p-1 text-muted hover:bg-sunken hover:text-ink">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          {target.kind === "evidence" ? (
            item ? (
              <EvidenceDetail item={item} />
            ) : (
              <p className="text-sm text-muted">Källan finns inte längre i underlaget.</p>
            )
          ) : (
            <MissingCitation query={target.query} projectId={projectId} />
          )}
        </div>
      </aside>
    </div>
  );
}

function EvidenceDetail({ item }: { item: ExpandedEvidenceDto }) {
  const chunk = useQuery({
    queryKey: ["chunk", item.chunkId],
    queryFn: () => documentsApi.chunk(item.chunkId!),
    enabled: item.chunkId != null,
    staleTime: 10 * 60_000,
  });
  const text = chunk.data?.content || item.content;
  const meta = [item.chapter, item.paragraph].filter(Boolean).join(" ");

  return (
    <div className="space-y-4 text-sm">
      {meta && <p className="text-xs text-muted">{meta}</p>}
      {item.annotation && (
        <blockquote className="border-l-2 border-accent/40 pl-3 italic text-muted">
          <span className="not-italic text-xs font-semibold uppercase tracking-wide">Din kommentar: </span>
          {item.annotation}
        </blockquote>
      )}
      {chunk.isLoading && <Spinner label="Hämtar textstället…" />}
      {text ? (
        <p className="whitespace-pre-line rounded-md bg-sunken/60 p-4 text-[15px] leading-7">{text}</p>
      ) : (
        !chunk.isLoading && <p className="text-muted">Ingen text sparad för den här källan – endast hänvisningen.</p>
      )}
      {item.documentId && (
        <Link
          to={`/dokument/${item.documentId}${item.chunkId ? `#chunk-${item.chunkId}` : ""}`}
          className="inline-flex items-center gap-1 text-accent hover:underline"
        >
          Öppna i rättskällor <ExternalLink className="size-3.5" />
        </Link>
      )}
    </div>
  );
}

function MissingCitation({ query, projectId }: { query: string; projectId: number }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-danger">
        <p className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="size-4" aria-hidden /> Kontrollera hänvisningen
        </p>
        <p className="mt-1 text-xs">
          Analysen hänvisar till <strong>{query}</strong>, som inte finns bland utredningens rättskällor. Det kan vara en riktig källa som saknas i
          underlaget – eller en felaktig hänvisning från AI:n.
        </p>
      </div>
      <LagenCheck query={query} projectId={projectId} />
      <Link
        to={`/dokument?q=${encodeURIComponent(query)}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-sm font-medium hover:bg-sunken"
      >
        <Search className="size-4" /> Sök i Lawlas rättskällor
      </Link>
      <p className="text-xs text-muted">
        Finns källan i Lawlas korpus är det bättre att lägga till avsnittet därifrån, eller via{" "}
        <Link to={`/utredning/${projectId}/rattskallor`} className="underline">
          steget Rättskällor
        </Link>
        . Kör sedan analysen igen så blir hänvisningen spårbar.
      </p>
    </div>
  );
}
