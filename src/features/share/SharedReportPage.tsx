import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Link2Off, Printer, Scale, X } from "lucide-react";
import { ApiError, shareApi } from "@/api/client";
import type { ExpandedEvidenceDto } from "@/api/types";
import { Button, Markdown, Spinner } from "@/components/ui";
import { CitationSummary } from "@/features/investigation/SourcePanel";
import { linkifyCitations, type CitationTarget } from "@/features/investigation/citations";
import { formatDate } from "@/lib/format";
import type { SharedEvidence } from "../../../shared/sharing";

const longDate = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric" });

/** Samma form som utredningens rättskällor, så att hänvisningarna kan kopplas på samma sätt. */
function toEvidence(e: SharedEvidence): ExpandedEvidenceDto {
  return {
    id: e.id,
    type: 0,
    displayLabel: e.displayLabel,
    content: e.content,
    annotation: e.annotation,
    documentId: null,
    documentTitle: e.documentTitle,
    chunkId: null,
    chunkIndex: null,
    chapter: e.chapter,
    paragraph: e.paragraph,
  };
}

/**
 * Skrivskyddad vy av en delad rapport. Kräver ingen inloggning: innehållet frystes när
 * länken skapades och hämtas från Workern, aldrig från backend.
 */
export default function SharedReportPage() {
  const token = useParams().token ?? "";
  const report = useQuery({ queryKey: ["shared", token], queryFn: () => shareApi.view(token), enabled: !!token, retry: false, staleTime: Infinity });

  useEffect(() => {
    const prev = document.title;
    if (report.data) document.title = `${report.data.title} – delad via Lawla`;
    return () => {
      document.title = prev;
    };
  }, [report.data]);

  const evidence = useMemo(() => (report.data?.evidence ?? []).map(toEvidence), [report.data]);
  const linked = useMemo(() => (report.data ? linkifyCitations(report.data.markdown, evidence) : null), [report.data, evidence]);
  const [target, setTarget] = useState<CitationTarget | null>(null);

  if (!token) return <Unavailable title="Länken är ofullständig" />;
  if (report.isLoading) return <Spinner label="Hämtar rapporten…" />;
  if (report.error || !report.data || !linked) {
    const err = report.error;
    const status = err instanceof ApiError ? err.status : 0;
    return (
      <Unavailable
        title={status === 410 ? "Länken gäller inte längre" : "Rapporten kunde inte hämtas"}
        message={err instanceof Error ? err.message : undefined}
      />
    );
  }

  const r = report.data;
  const sharedBy = [r.createdBy, longDate.format(new Date(r.createdAt))].filter(Boolean).join(" · ");

  return (
    <div className="min-h-full bg-paper">
      <header className="border-b border-line bg-surface print:hidden">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 text-sm">
            <Scale className="size-5 text-accent" aria-hidden />
            <span className="font-semibold">Lawla</span>
            <span className="text-muted">· delad rapport</span>
          </div>
          <Button size="sm" variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>
            Skriv ut / PDF
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
        <p className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted print:hidden">
          <span>Delad av {sharedBy}</span>
          {r.expiresAt && (
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="size-3.5" aria-hidden /> Länken gäller till {formatDate(r.expiresAt)}
            </span>
          )}
        </p>
        <article className="rounded-lg border border-line bg-surface p-6 sm:p-10 print:border-0 print:p-0">
          <Markdown onCitation={setTarget}>{linked.markdown}</Markdown>
          <CitationSummary report={linked.report} onOpen={setTarget} />
        </article>
        <p className="mt-6 text-xs text-muted print:hidden">
          Rapporten visas som den såg ut när länken skapades. Hänvisningar är klickbara och visar textstället i det underlag som delades.
        </p>
      </main>

      {target && <SharedSourcePanel target={target} evidence={evidence} onClose={() => setTarget(null)} />}
    </div>
  );
}

function Unavailable({ title, message }: { title: string; message?: string }) {
  return (
    <div className="grid min-h-full place-items-center p-6">
      <div className="max-w-md text-center">
        <Link2Off className="mx-auto mb-4 size-10 text-muted" aria-hidden />
        <h1 className="font-serif text-2xl">{title}</h1>
        {message && <p className="mt-2 text-sm text-muted">{message}</p>}
        <p className="mt-4 text-sm text-muted">Kontakta den som delade rapporten för en ny länk.</p>
        <Link to="/" className="mt-6 inline-block text-sm text-accent hover:underline">
          Till Lawla
        </Link>
      </div>
    </div>
  );
}

/** Källpanel för den delade vyn: visar bara det som frystes med rapporten, inga anrop till backend. */
function SharedSourcePanel({ target, evidence, onClose }: { target: CitationTarget; evidence: ExpandedEvidenceDto[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const item = target.kind === "evidence" ? evidence.find((e) => e.id === target.evidenceId) : undefined;
  const meta = item ? [item.chapter, item.paragraph].filter(Boolean).join(" ") : "";

  return (
    <div className="fixed inset-0 z-40 flex justify-end print:hidden" role="dialog" aria-modal="true" aria-label="Rättskälla">
      <button className="flex-1 bg-ink/30" onClick={onClose} aria-label="Stäng" />
      <aside className="flex h-full w-full max-w-lg flex-col border-l border-line bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {target.kind === "evidence" ? "Textställe i underlaget" : "Hänvisning som saknas i underlaget"}
            </p>
            <h2 className="mt-1 font-serif text-lg leading-snug">
              {target.kind === "evidence" ? item?.displayLabel || item?.documentTitle || "Källa" : target.query}
            </h2>
            {item?.documentTitle && item.displayLabel && <p className="text-sm text-muted">{item.documentTitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Stäng" className="rounded p-1 text-muted hover:bg-sunken hover:text-ink">
            <X className="size-5" />
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          {target.kind === "search" && (
            <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-danger">
              <p className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="size-4" aria-hidden /> Kontrollera hänvisningen
              </p>
              <p className="mt-1 text-xs">
                Rapporten hänvisar till <strong>{target.query}</strong>, som inte finns bland de rättskällor som delades med rapporten.
              </p>
            </div>
          )}
          {target.kind === "evidence" && !item && <p className="text-muted">Källan följde inte med rapporten.</p>}
          {item && (
            <>
              {meta && <p className="text-xs text-muted">{meta}</p>}
              {item.annotation && (
                <blockquote className="border-l-2 border-accent/40 pl-3 italic text-muted">
                  <span className="not-italic text-xs font-semibold uppercase tracking-wide">Kommentar: </span>
                  {item.annotation}
                </blockquote>
              )}
              {item.content ? (
                <p className="whitespace-pre-line rounded-md bg-sunken/60 p-4 text-[15px] leading-7">{item.content}</p>
              ) : (
                <p className="text-muted">Ingen text sparad för den här källan – endast hänvisningen.</p>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
