import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileDown, Printer } from "lucide-react";
import { projectsApi } from "@/api/client";
import type { LegalIssueAnalysisDto } from "@/api/types";
import { Button, Card, ErrorNote, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useAuth } from "@/features/auth/auth";
import { downloadBlob, markdownToDocxBlob } from "@/lib/docxExport";
import { formatDateTime, slugify } from "@/lib/format";
import { buildReportMarkdown, REPORT_SECTIONS } from "./report";
import { CitedMarkdown } from "./SourcePanel";

const longDate = new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric" });

export default function ReportPage() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const toast = useToast();

  const project = useQuery({ queryKey: ["project", id], queryFn: () => projectsApi.get(id), enabled: Number.isFinite(id) });
  const evidence = useQuery({ queryKey: ["evidence", id], queryFn: () => projectsApi.evidence(id), enabled: Number.isFinite(id) });
  const analyses = useQuery({ queryKey: ["analyses", id], queryFn: () => projectsApi.analyses(id), enabled: Number.isFinite(id) });
  const issues = project.data?.legalIssues ?? [];
  const issueResults = useQueries({
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
  const { loading: issuesLoading, issueAnalyses } = issueResults;

  const [include, setInclude] = useState<Set<string>>(() => new Set(REPORT_SECTIONS.map((s) => s.key)));
  const [analysisId, setAnalysisId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const sortedAnalyses = useMemo(() => [...(analyses.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [analyses.data]);
  const analysis = sortedAnalyses.find((a) => a.id === analysisId) ?? sortedAnalyses[0] ?? null;

  const markdown = useMemo(
    () =>
      project.data
        ? buildReportMarkdown(
            { project: project.data, evidence: evidence.data ?? [], issueAnalyses, analysis, date: longDate.format(new Date()), author: user?.name ?? null },
            include,
          )
        : "",
    [project.data, evidence.data, issueAnalyses, analysis, include, user?.name],
  );

  if (!Number.isFinite(id)) return <Navigate to="/" replace />;
  if (project.isLoading || evidence.isLoading || analyses.isLoading || issuesLoading) return <Spinner label="Sammanställer rapporten…" />;
  if (project.error || !project.data) return <ErrorNote error={project.error} onRetry={() => project.refetch()} />;

  const filename = `${slugify(project.data.title ?? "rattsutredning")}-${new Date().toISOString().slice(0, 10)}`;

  async function exportWord() {
    setExporting(true);
    try {
      const blob = await markdownToDocxBlob(markdown, { title: project.data?.title || "Rättsutredning", author: user?.name });
      downloadBlob(`${filename}.docx`, blob);
      toast("Word-dokumentet är nedladdat.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Exporten misslyckades.", "error");
    } finally {
      setExporting(false);
    }
  }

  function toggle(key: string) {
    setInclude((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div>
      <div className="print:hidden">
        <Link to={`/utredning/${id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> {project.data.title || "Utredningen"}
        </Link>
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl leading-tight">Rapport</h1>
            <p className="mt-1 text-sm text-muted">Hela utredningen som ett dokument att lämna ifrån sig. Välj vad som ska ingå.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>
              Skriv ut / PDF
            </Button>
            <Button icon={<FileDown className="size-4" />} loading={exporting} onClick={() => void exportWord()}>
              Ladda ner Word
            </Button>
          </div>
        </div>

        <Card className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 p-4 text-sm">
          {REPORT_SECTIONS.map((s) => (
            <label key={s.key} className="flex items-center gap-1.5">
              <input type="checkbox" checked={include.has(s.key)} onChange={() => toggle(s.key)} /> {s.title}
            </label>
          ))}
          {sortedAnalyses.length > 1 && (
            <label className="ml-auto flex items-center gap-2">
              <span className="text-muted">Samlad analys:</span>
              <select value={analysis?.id ?? ""} onChange={(e) => setAnalysisId(Number(e.target.value))} className="h-8 rounded-md border border-line bg-surface px-2 text-sm">
                {sortedAnalyses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatDateTime(a.createdAt)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </Card>
        <p className="mb-3 text-xs text-muted">
          Hänvisningar är klickbara på skärmen och visar textstället i underlaget. I Word- och PDF-versionen blir de vanlig text; hänvisningar som
          saknas i underlaget markeras med prickad understrykning i utskriften.
        </p>
      </div>

      <article className="rounded-lg border border-line bg-surface p-6 sm:p-10 print:border-0 print:p-0">
        <CitedMarkdown markdown={markdown} evidence={evidence.data ?? []} projectId={id} summary={false} />
      </article>
    </div>
  );
}
