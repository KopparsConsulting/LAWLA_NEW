import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, FileText, Play, Square } from "lucide-react";
import { projectsApi } from "@/api/client";
import type { ProjectAnalysisDto, ProjectDetailDto } from "@/api/types";
import { Button, Card, EmptyState, ErrorNote, Markdown, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";
import { downloadText, formatDateTime, slugify } from "@/lib/format";

export function AnalysisStep({ project, aiEnabled }: { project: ProjectDetailDto; aiEnabled: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["analyses", project.id];
  const analyses = useQuery({ queryKey: key, queryFn: () => projectsApi.analyses(project.id) });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [streamText, setStreamText] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const sorted = [...(analyses.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = sorted.find((a) => a.id === selectedId) ?? sorted[0];

  const counts = {
    questions: project.questions?.length ?? 0,
    circumstances: project.circumstances?.length ?? 0,
    issues: project.legalIssues?.length ?? 0,
    evidence: project.evidence?.length ?? 0,
  };
  const ready = counts.issues > 0;

  async function run() {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setStreamText("");
    let text = "";
    try {
      const result = await projectsApi.runAnalysis(
        project.id,
        (ev) => {
          if (ev.type === "content" && ev.content) {
            text += ev.content;
            setStreamText(text);
          } else if (ev.type === "error") {
            throw new Error(ev.error || "Analysen misslyckades.");
          }
        },
        controller.signal,
      );
      await qc.invalidateQueries({ queryKey: key });
      if (result && typeof result === "object" && "id" in result) setSelectedId((result as ProjectAnalysisDto).id);
      else setSelectedId(null);
      setStreamText("");
      toast("Analysen är klar.");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e);
    } finally {
      setRunning(false);
    }
  }

  function exportMarkdown(a: ProjectAnalysisDto) {
    const header = `# ${project.title ?? "Rättsutredning"}\n\n_Analys skapad ${formatDateTime(a.createdAt)} med Lawla. Utkast – granskas av jurist._\n\n`;
    downloadText(`${slugify(project.title ?? "rattsutredning")}-analys-${a.id}.md`, header + (a.outputContent ?? ""));
  }

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm">
            <p className="font-medium">Underlag för analysen</p>
            <p className="text-muted">
              {counts.questions} frågor · {counts.circumstances} omständigheter · {counts.issues} rättsfrågor · {counts.evidence} rättskällor
            </p>
          </div>
          {aiEnabled &&
            (running ? (
              <Button variant="secondary" icon={<Square className="size-3.5" />} onClick={() => abortRef.current?.abort()}>
                Avbryt
              </Button>
            ) : (
              <Button icon={<Play className="size-4" />} onClick={run} disabled={!ready}>
                {sorted.length ? "Ta fram ny analys" : "Ta fram analys"}
              </Button>
            ))}
        </div>
        {!ready && <p className="mt-2 text-xs text-muted">Formulera minst en rättsfråga innan du tar fram en samlad analys.</p>}
        {!aiEnabled && <p className="mt-2 text-xs text-muted">AI-analys är avstängd i plattformen just nu.</p>}
      </Card>

      {error != null && <ErrorNote error={error} />}

      {running && (
        <Card className="p-6">
          <p className="mb-3 animate-pulse text-sm text-muted">Lawla skriver analysen…</p>
          {streamText && <Markdown>{streamText}</Markdown>}
        </Card>
      )}

      {analyses.isLoading && <Spinner />}
      {analyses.error && <ErrorNote error={analyses.error} onRetry={() => analyses.refetch()} />}
      {!running && analyses.data && sorted.length === 0 && (
        <EmptyState title="Ingen samlad analys ännu">När rättsfrågor och källor är på plats kan Lawla skriva ett första utkast.</EmptyState>
      )}

      {!running && selected && (
        <div className={sorted.length > 1 ? "grid gap-6 xl:grid-cols-[1fr_200px]" : ""}>
          <Card className="p-6 sm:p-8">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <p className="text-xs text-muted">Utkast · {formatDateTime(selected.createdAt)}</p>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy className="size-3.5" />}
                  onClick={() => {
                    void navigator.clipboard.writeText(selected.outputContent ?? "");
                    toast("Analysen är kopierad.");
                  }}
                >
                  Kopiera
                </Button>
                <Button size="sm" variant="ghost" icon={<Download className="size-3.5" />} onClick={() => exportMarkdown(selected)}>
                  Ladda ner
                </Button>
              </div>
            </div>
            <Markdown>{selected.outputContent ?? ""}</Markdown>
            <p className="mt-8 border-t border-line pt-3 text-xs text-muted">
              AI-genererat utkast. Kontrollera hänvisningar och slutsatser innan det används i rådgivning.
            </p>
          </Card>
          {sorted.length > 1 && (
            <aside>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Versioner</p>
              <ul className="space-y-1">
                {sorted.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => setSelectedId(a.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${a.id === selected.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken"}`}
                    >
                      <FileText className="size-3.5 shrink-0" /> {formatDateTime(a.createdAt)}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
