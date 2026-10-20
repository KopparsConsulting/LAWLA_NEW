import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CirclePlus, Play, Save } from "lucide-react";
import { projectsApi } from "@/api/client";
import { Button, Markdown, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import type { CitationTarget } from "./citations";
import { circumstanceText, type UncertaintySplit } from "./uncertainties";

export interface ComplementOptions {
  /** Kör analysen igen med de nya omständigheterna. */
  onRerun?: () => void;
  rerunning?: boolean;
  rerunLabel?: string;
}

/**
 * Osäkerhetsavsnittet i en analys, med ett fält under varje punkt där juristen fyller i
 * omständigheter som besvarar den. Det som fylls i sparas som omständigheter i ärendet
 * (samma som steget Omständigheter), knutna till punktens rubrik.
 */
export function UncertaintySection({
  split,
  projectId,
  onCitation,
  options,
}: {
  split: UncertaintySplit;
  projectId: number;
  onCitation: (t: CitationTarget) => void;
  options: ComplementOptions;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [drafts, setDrafts] = useState<string[]>(() => split.items.map(() => ""));
  const [saved, setSaved] = useState<string[][]>(() => split.items.map(() => []));

  const add = useMutation({
    mutationFn: async (indexes: number[]) => {
      const done: number[] = [];
      for (const i of indexes) {
        const text = drafts[i]?.trim();
        if (!text) continue;
        await projectsApi.addItem(projectId, "circumstances", circumstanceText(split.items[i]!, text));
        done.push(i);
      }
      return done;
    },
    onSuccess: (done) => {
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      setSaved((prev) => prev.map((list, i) => (done.includes(i) ? [...list, drafts[i]!.trim()] : list)));
      setDrafts((prev) => prev.map((d, i) => (done.includes(i) ? "" : d)));
      if (done.length) toast(done.length === 1 ? "Omständigheten är tillagd i ärendet." : `${done.length} omständigheter är tillagda i ärendet.`);
    },
    onError: (e) => toast(e.message, "error"),
  });

  const filled = drafts.map((d, i) => (d.trim() ? i : -1)).filter((i) => i >= 0);
  const savedCount = saved.reduce((n, l) => n + l.length, 0);

  async function rerun() {
    // Ifyllda men osparade fält sparas först, så att de kommer med i analysen.
    if (filled.length) {
      try {
        await add.mutateAsync(filled);
      } catch {
        return;
      }
    }
    options.onRerun?.();
  }

  return (
    <section aria-label={split.headingText}>
      <Markdown onCitation={onCitation}>{split.heading}</Markdown>
      {split.intro && <Markdown onCitation={onCitation}>{split.intro}</Markdown>}
      <p className="mb-3 mt-1 text-xs text-muted print:hidden">
        Komplettera med det du vet om varje punkt. Det sparas som omständigheter i ärendet och används när analysen körs igen.
      </p>
      <ol className="space-y-3">
        {split.items.map((item, i) => (
          <li key={i} className="rounded-lg border border-line bg-sunken/30 p-3">
            <div className="prose-tight">
              <Markdown onCitation={onCitation}>{item.markdown}</Markdown>
            </div>
            {saved[i]!.length > 0 && (
              <ul className="mt-2 space-y-1">
                {saved[i]!.map((s, j) => (
                  <li key={j} className="flex items-start gap-1.5 text-sm text-ok">
                    <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden /> <span className="text-ink">{s}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 print:hidden">
              <label htmlFor={`unc-${i}`} className="sr-only">
                Omständigheter om {item.title ?? `punkt ${i + 1}`}
              </label>
              <Textarea
                id={`unc-${i}`}
                rows={2}
                value={drafts[i]}
                onChange={(e) => setDrafts((prev) => prev.map((d, j) => (j === i ? e.target.value : d)))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && drafts[i]?.trim()) add.mutate([i]);
                }}
                placeholder={saved[i]!.length ? "Lägg till fler omständigheter…" : `Vad vet du om ${item.title ? item.title.toLowerCase() : "detta"}?`}
                disabled={add.isPending}
              />
              <div className="mt-1.5 flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<CirclePlus className="size-3.5" />}
                  disabled={!drafts[i]?.trim() || add.isPending}
                  loading={add.isPending && add.variables?.length === 1 && add.variables[0] === i}
                  onClick={() => add.mutate([i])}
                >
                  Lägg till som omständighet
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ol>
      {(filled.length > 0 || savedCount > 0) && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 print:hidden">
          {savedCount > 0 && (
            <p className="mr-auto text-xs text-muted">
              {savedCount === 1 ? "1 ny omständighet" : `${savedCount} nya omständigheter`} i ärendet – kör analysen igen så tas de med.
            </p>
          )}
          {filled.length > 1 && (
            <Button size="sm" variant="secondary" icon={<Save className="size-3.5" />} loading={add.isPending && add.variables?.length !== 1} onClick={() => add.mutate(filled)}>
              Spara alla ({filled.length})
            </Button>
          )}
          {options.onRerun && (
            <Button size="sm" icon={<Play className="size-3.5" />} loading={options.rerunning} disabled={add.isPending} onClick={() => void rerun()}>
              {filled.length ? "Spara och kör analysen igen" : (options.rerunLabel ?? "Kör analysen igen")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
