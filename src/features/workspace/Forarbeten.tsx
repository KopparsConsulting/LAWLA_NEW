/**
 * Förarbeten till en paragraf: senaste propositionens specialkommentar (författningskommentar)
 * öppen överst, och tidigare ändringar – inklusive när paragrafen fått ny beteckning – som
 * underfönster som fälls ut och hämtar sin kommentar vid behov.
 */
import { createContext, useContext, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { BookPlus, Check, ChevronRight, Columns2, ExternalLink, History, ScrollText, X } from "lucide-react";
import { lagenApi, projectsApi, riksdagenApi } from "@/api/client";
import { Button, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";
import { lawNameForMatch, type ProvisionForarbeten, type ProvisionHistoryEntry } from "../../../shared/forarbeten";
import { parseBeteckning } from "../../../shared/riksdagen";
import { lawAbbreviation, stripFragment, type SourceRef } from "../../../shared/sourceDoc";

export interface ScrollTarget {
  anchor?: string | null;
  /** Rulla till första block som innehåller texterna i tur och ordning (när ankaret inte är känt). */
  text?: string[] | null;
}

/** Arbetsytans åtgärder som läsytan och förarbetspanelen behöver. */
export const WorkspaceContext = createContext<{
  projectId: number;
  openBeside: (ref: SourceRef, target?: ScrollTarget) => void;
} | null>(null);

const STALE = 6 * 60 * 60_000;

const KIND_TEXT: Record<ProvisionHistoryEntry["kind"], string> = {
  ursprunglig: "Ursprunglig lydelse",
  "införd": "Paragrafen infördes",
  "ändrad": "Ändrad",
  "ny beteckning": "Ny beteckning",
};

export function ForarbetenPanel({ lawUri, anchor, lawTitle, label, onClose }: { lawUri: string; anchor: string; lawTitle: string; label: string; onClose: () => void }) {
  const data = useQuery({ queryKey: ["forarbeten", lawUri, anchor], queryFn: () => lagenApi.forarbeten(`${stripFragment(lawUri)}#${anchor}`), staleTime: STALE, retry: 1 });
  const abbr = lawAbbreviation(lawTitle);
  const withProp = data.data?.history.filter((h) => h.prop) ?? [];
  const latest = withProp[0];
  const [open, setOpen] = useState<Set<string>>(new Set());

  return (
    <div
      data-noselect
      onMouseUp={(e) => e.stopPropagation()}
      className="mt-2 rounded-lg border border-accent/30 bg-accent-soft/40 text-sm shadow-sm"
      role="region"
      aria-label={`Förarbeten till ${label}`}
    >
      <div className="flex items-center gap-2 border-b border-accent/20 px-3 py-2">
        <ScrollText className="size-4 text-accent" aria-hidden />
        <p className="min-w-0 flex-1 font-medium">
          Förarbeten till {label} {abbr ?? ""}
        </p>
        <button onClick={onClose} aria-label="Stäng förarbeten" className="rounded p-0.5 text-muted hover:bg-surface hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      <div className="space-y-3 p-3">
        {data.isLoading && <Spinner label="Hämtar ändringshistoriken från lagen.nu…" />}
        {data.error && <p className="text-xs text-danger">Ändringshistoriken kunde inte hämtas från lagen.nu.</p>}
        {data.data && data.data.history.length === 0 && <p className="text-xs text-muted">lagen.nu har inga uppgifter om förarbeten till paragrafen.</p>}
        {latest && (
          <section>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Senaste specialkommentar</p>
            <EntryCard entry={latest} law={data.data!} lawTitle={lawTitle} defaultOpen />
          </section>
        )}
        {data.data && data.data.history.length > 1 && (
          <section>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
              <History className="size-3" aria-hidden /> Historik ({data.data.history.length - (latest ? 1 : 0)})
            </p>
            <ol className="space-y-1.5">
              {data.data.history
                .filter((h) => h !== latest)
                .map((h) => {
                  const key = `${h.sfs}-${h.label}`;
                  return (
                    <li key={key}>
                      {h.prop ? (
                        <EntryCard
                          entry={h}
                          law={data.data!}
                          lawTitle={lawTitle}
                          open={open.has(key)}
                          onToggle={() => setOpen((s) => toggle(s, key))}
                        />
                      ) : (
                        <p className="rounded-md border border-line bg-surface px-3 py-2 text-xs text-muted">
                          <EntryTitle entry={h} /> · inga förarbeten angivna
                        </p>
                      )}
                    </li>
                  );
                })}
            </ol>
          </section>
        )}
        <p className="text-[11px] leading-4 text-muted">
          Historiken bygger på lagen.nu:s uppgifter om ändringsförfattningar, och kommentaren hämtas ur propositionens författningskommentar. Kontrollera mot propositionen.
        </p>
      </div>
    </div>
  );
}

function EntryTitle({ entry: h }: { entry: ProvisionHistoryEntry }) {
  return (
    <span>
      <span className="font-medium text-ink">{h.prop ?? h.sfs}</span>
      {" · "}
      {KIND_TEXT[h.kind]}
      {h.kind === "ny beteckning" && h.previous ? ` (tidigare ${h.previous})` : ""}
      {h.kind !== "ny beteckning" && h.label ? ` · ${h.label}` : ""}
      {" · "}
      {h.sfs}
      {h.ikraft ? `, i kraft ${h.ikraft}` : ""}
    </span>
  );
}

function EntryCard({
  entry: h,
  law,
  lawTitle,
  defaultOpen,
  open: controlled,
  onToggle,
}: {
  entry: ProvisionHistoryEntry & { propUri: string | null };
  law: ProvisionForarbeten;
  lawTitle: string;
  defaultOpen?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [own, setOwn] = useState(!!defaultOpen);
  const open = controlled ?? own;
  const toggle = onToggle ?? (() => setOwn((v) => !v));
  return (
    <div className="rounded-md border border-line bg-surface">
      <button onClick={toggle} aria-expanded={open} className="flex w-full items-start gap-1.5 px-3 py-2 text-left text-xs text-muted hover:bg-sunken/50">
        <ChevronRight className={clsx("mt-0.5 size-3.5 shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
        <EntryTitle entry={h} />
      </button>
      {open && <Commentary entry={h} law={law} lawTitle={lawTitle} />}
    </div>
  );
}

function Commentary({ entry: h, law, lawTitle }: { entry: ProvisionHistoryEntry & { propUri: string | null }; law: ProvisionForarbeten; lawTitle: string }) {
  const ctx = useContext(WorkspaceContext);
  const qc = useQueryClient();
  const toast = useToast();
  const name = lawNameForMatch(law.lawTitle ?? lawTitle);
  const q = useQuery({
    queryKey: ["kommentar", h.prop, law.lawSfs, h.label, h.previous],
    queryFn: () => lagenApi.kommentar({ prop: h.prop!, law: law.lawSfs, name, lagrum: h.label, alt: h.previous }),
    staleTime: STALE,
    retry: 1,
  });
  const c = q.data?.found[0];
  const abbr = lawAbbreviation(law.lawTitle ?? lawTitle);
  const text = q.data?.found.map((f) => (q.data!.found.length > 1 ? `${f.section}\n\n${plain(f.markdown)}` : plain(f.markdown))).join("\n\n— — —\n\n") ?? "";

  const add = useMutation({
    mutationFn: () =>
      projectsApi.addEvidence(ctx!.projectId, {
        documentId: null,
        chunkId: null,
        content: text,
        displayLabel: `${h.prop} – författningskommentar till ${q.data?.lagrum ?? h.label} ${abbr ?? ""}`.trim(),
        annotation: `Källa: lagen.nu ${h.propUri} (${new Date().toISOString().slice(0, 10)}).`,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["evidence", ctx!.projectId] });
      void qc.invalidateQueries({ queryKey: ["project", ctx!.projectId] });
      toast("Specialkommentaren är tillagd i underlaget.");
    },
    onError: (e) => toast(e.message, "error"),
  });

  async function openFromRiksdagen() {
    const bet = h.prop && parseBeteckning(h.prop);
    if (!bet || !ctx) return;
    try {
      const r = await riksdagenApi.find("prop", `${bet.rm}:${bet.bet}`);
      ctx.openBeside({ kind: "riksdagen", dokId: r.dokId }, { text: ["Författningskommentar", h.label] });
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  const openProp = () =>
    h.propUri && ctx?.openBeside({ kind: "lagen", uri: h.propUri }, { text: c ? [c.section, firstWords(c.markdown)].filter(Boolean) : ["Författningskommentar", h.label] });

  return (
    <div className="border-t border-line px-3 pb-3 pt-2">
      {q.isLoading && <Spinner label={`Söker kommentaren i ${h.prop}…`} />}
      {q.error && (
        <p className="text-xs text-muted">
          Propositionen kunde inte hämtas från lagen.nu.{" "}
          <button onClick={() => void openFromRiksdagen()} className="text-accent underline">
            Öppna från riksdagen.se
          </button>
        </p>
      )}
      {q.data && !c && (
        <p className="text-xs leading-5 text-muted">
          {h.kind === "ny beteckning"
            ? `Ändringen gällde paragrafens beteckning (tidigare ${h.previous}); ${h.prop} kommenterar den inte särskilt.`
            : `Ingen författningskommentar till ${h.label} hittades i ${h.prop}. Den kan finnas under en gemensam rubrik – öppna propositionen och sök.`}
        </p>
      )}
      {c && (
        <>
          {q.data!.lagrum && q.data!.lagrum !== h.label && <p className="mb-1 text-[11px] text-muted">Kommenteras som {q.data!.lagrum}.</p>}
          {q.data!.found.length > 1 && <p className="mb-1 text-[11px] text-muted">{q.data!.found.length} kommentarer (flera lagförslag i propositionen).</p>}
          <p className="text-xs font-medium text-ink">{c.heading}</p>
          <div className="mt-1 max-h-80 overflow-y-auto whitespace-pre-line rounded bg-sunken/50 p-2.5 text-[13.5px] leading-6">{text}</div>
        </>
      )}
      {!q.isLoading && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {c && ctx && (
            <Button size="sm" variant="secondary" icon={add.isSuccess ? <Check className="size-3.5" /> : <BookPlus className="size-3.5" />} loading={add.isPending} disabled={add.isSuccess} onClick={() => add.mutate()}>
              {add.isSuccess ? "Tillagd" : "Lägg till i underlaget"}
            </Button>
          )}
          {h.propUri && ctx && (
            <Button size="sm" variant="ghost" icon={<Columns2 className="size-3.5" />} onClick={openProp}>
              Öppna propositionen bredvid
            </Button>
          )}
          {h.propUri && (
            <a href={h.propUri} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 px-2 text-xs text-muted hover:text-accent">
              lagen.nu <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

const plain = (md: string) =>
  md
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

function firstWords(md: string): string {
  return plain(md).split(/\s+/).slice(0, 8).join(" ");
}

function toggle(set: Set<string>, key: string) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
