import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, FlaskConical } from "lucide-react";
import { projectsApi } from "@/api/client";
import type { ProjectDetailDto, ProjectLegalIssueDto } from "@/api/types";
import { Badge, Button, Card, EmptyState, ErrorNote, Markdown, Spinner } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

export function IssueAnalysesStep({ project, aiEnabled }: { project: ProjectDetailDto; aiEnabled: boolean }) {
  const issues = [...(project.legalIssues ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  if (issues.length === 0) {
    return (
      <EmptyState title="Inga rättsfrågor att analysera">
        <Link to={`/utredning/${project.id}/rattsfragor`} className="text-accent underline">
          Formulera rättsfrågor först
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      {(project.evidence?.length ?? 0) === 0 && (
        <p className="rounded-md bg-accent-soft p-3 text-sm text-accent">
          Tips: delanalyserna blir bättre när du har kopplat rättskällor till utredningen.
        </p>
      )}
      {!aiEnabled && <p className="text-sm text-muted">AI-analys är avstängd i plattformen just nu.</p>}
      {issues.map((issue, i) => (
        <IssueCard key={issue.id} projectId={project.id} issue={issue} index={i + 1} aiEnabled={aiEnabled} />
      ))}
    </div>
  );
}

function IssueCard({ projectId, issue, index, aiEnabled }: { projectId: number; issue: ProjectLegalIssueDto; index: number; aiEnabled: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(issue.analysisCount > 0);
  const key = ["issueAnalyses", projectId, issue.id];
  const analyses = useQuery({ queryKey: key, queryFn: () => projectsApi.issueAnalyses(projectId, issue.id), enabled: open });

  const analyze = useMutation({
    mutationFn: () => projectsApi.analyzeIssue(projectId, issue.id),
    onSuccess: () => {
      setOpen(true);
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  const sorted = [...(analyses.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [latest, ...older] = sorted;

  return (
    <Card>
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5 font-serif text-sm text-muted">{index}.</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium leading-relaxed">{issue.text}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <Badge tone={issue.analysisCount > 0 ? "ok" : "neutral"}>
              {issue.analysisCount > 0 ? `${issue.analysisCount} analys${issue.analysisCount > 1 ? "er" : ""}` : "Ej analyserad"}
            </Badge>
            {issue.analysisCount > 0 && (
              <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-0.5 text-xs text-accent">
                <ChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} /> {open ? "Dölj" : "Visa"}
              </button>
            )}
          </div>
        </div>
        {aiEnabled && (
          <Button size="sm" variant="secondary" icon={<FlaskConical className="size-3.5" />} loading={analyze.isPending} onClick={() => analyze.mutate()}>
            {issue.analysisCount > 0 ? "Analysera igen" : "Analysera"}
          </Button>
        )}
      </div>
      {analyze.isPending && <p className="animate-pulse border-t border-line px-4 py-3 text-sm text-muted">Analyserar rättsfrågan – det kan ta en minut…</p>}
      {analyze.error && (
        <div className="border-t border-line p-4">
          <ErrorNote error={analyze.error} />
        </div>
      )}
      {open && (
        <div className="border-t border-line p-4">
          {analyses.isLoading && <Spinner />}
          {analyses.error && <ErrorNote error={analyses.error} onRetry={() => analyses.refetch()} />}
          {latest && (
            <>
              <p className="mb-2 text-xs text-muted">Senaste analys · {formatDateTime(latest.createdAt)}</p>
              <Markdown>{latest.outputContent ?? ""}</Markdown>
            </>
          )}
          {older.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs text-muted">Tidigare analyser ({older.length})</summary>
              <div className="mt-3 space-y-4">
                {older.map((a) => (
                  <div key={a.id} className="border-l-2 border-line pl-3">
                    <p className="mb-1 text-xs text-muted">{formatDateTime(a.createdAt)}</p>
                    <Markdown>{a.outputContent ?? ""}</Markdown>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}
