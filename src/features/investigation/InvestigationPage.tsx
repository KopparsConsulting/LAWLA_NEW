import { Link, Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import clsx from "clsx";
import { projectsApi } from "@/api/client";
import type { ProjectDetailDto } from "@/api/types";
import { ErrorNote, Spinner } from "@/components/ui";
import { useFeatures } from "@/features/auth/auth";
import { CaseStep } from "./steps/CaseStep";
import { ItemsStep } from "./steps/ItemsStep";
import { SourcesStep } from "./steps/SourcesStep";
import { IssueAnalysesStep } from "./steps/IssueAnalysesStep";
import { AnalysisStep } from "./steps/AnalysisStep";

interface Step {
  key: string;
  label: string;
  hint: string;
  done: (p: ProjectDetailDto) => boolean;
}

export const STEPS: Step[] = [
  { key: "arende", label: "Ärendet", hint: "Beskriv vad klienten söker hjälp med", done: (p) => !!p.caseOverview?.trim() },
  { key: "fragor", label: "Klientens frågor", hint: "Vad vill klienten ha svar på?", done: (p) => (p.questions?.length ?? 0) > 0 },
  { key: "omstandigheter", label: "Omständigheter", hint: "Relevanta fakta i ärendet", done: (p) => (p.circumstances?.length ?? 0) > 0 },
  { key: "rattsfragor", label: "Rättsfrågor", hint: "Frågor som rätten måste besvara", done: (p) => (p.legalIssues?.length ?? 0) > 0 },
  { key: "rattskallor", label: "Rättskällor", hint: "Lagrum, praxis och doktrin som underlag", done: (p) => (p.evidence?.length ?? 0) > 0 },
  { key: "delanalyser", label: "Delanalyser", hint: "Analys per rättsfråga", done: (p) => (p.legalIssues ?? []).some((i) => i.analysisCount > 0) },
  { key: "analys", label: "Samlad analys", hint: "Utkast till rättsutredning", done: () => false },
];

export default function InvestigationPage() {
  const params = useParams();
  const id = Number(params.id);
  const features = useFeatures();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => projectsApi.get(id), enabled: Number.isFinite(id) });

  if (!Number.isFinite(id)) return <Navigate to="/" replace />;
  if (project.isLoading) return <Spinner />;
  if (project.error || !project.data) return <ErrorNote error={project.error} onRetry={() => project.refetch()} />;

  const p = project.data;
  const stepIndex = Math.max(0, STEPS.findIndex((s) => s.key === params.step));
  if (!params.step) {
    // Öppna första ofärdiga steget.
    const next = STEPS.findIndex((s) => !s.done(p));
    return <Navigate to={`/utredning/${id}/${STEPS[next === -1 ? STEPS.length - 1 : next]!.key}`} replace />;
  }
  const step = STEPS[stepIndex]!;
  const prev = STEPS[stepIndex - 1];
  const next = STEPS[stepIndex + 1];
  const aiEnabled = features.ai.enabled && features.ai.ragEnabled;

  return (
    <div>
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Alla utredningar
      </Link>
      <h1 className="mb-6 font-serif text-3xl leading-tight">{p.title || "Namnlös utredning"}</h1>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Utredningens steg" className="min-w-0">
          <ol className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {STEPS.map((s, i) => {
              const active = s.key === step.key;
              const done = s.done(p);
              return (
                <li key={s.key} className="shrink-0">
                  <Link
                    to={`/utredning/${id}/${s.key}`}
                    aria-current={active ? "step" : undefined}
                    className={clsx(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
                      active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-sunken hover:text-ink",
                    )}
                  >
                    <span
                      className={clsx(
                        "grid size-6 shrink-0 place-items-center rounded-full border text-xs",
                        done ? "border-ok bg-ok text-white" : active ? "border-accent" : "border-line",
                      )}
                    >
                      {done ? <Check className="size-3.5" /> : i + 1}
                    </span>
                    <span className="whitespace-nowrap">{s.label}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="min-w-0">
          <header className="mb-6 border-b border-line pb-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Steg {stepIndex + 1} av {STEPS.length}
            </p>
            <h2 className="mt-1 font-serif text-2xl">{step.label}</h2>
            <p className="mt-1 text-sm text-muted">{step.hint}</p>
          </header>

          {step.key === "arende" && <CaseStep project={p} />}
          {step.key === "fragor" && (
            <ItemsStep
              project={p}
              kind="questions"
              items={p.questions ?? []}
              aiEnabled={aiEnabled}
              placeholder="T.ex. Kan äktenskapsförordet jämkas?"
              emptyText="Lägg till de frågor klienten vill ha besvarade."
            />
          )}
          {step.key === "omstandigheter" && (
            <ItemsStep
              project={p}
              kind="circumstances"
              items={p.circumstances ?? []}
              aiEnabled={aiEnabled}
              placeholder="T.ex. Förordet skrevs samma dag som vigseln"
              emptyText="Lägg till de fakta som kan ha rättslig betydelse."
            />
          )}
          {step.key === "rattsfragor" && (
            <ItemsStep
              project={p}
              kind="legal-issues"
              items={p.legalIssues ?? []}
              aiEnabled={aiEnabled}
              placeholder="T.ex. Är förordet oskäligt enligt 12 kap. 3 § ÄktB?"
              emptyText="Formulera de rättsfrågor som måste besvaras."
            />
          )}
          {step.key === "rattskallor" && <SourcesStep project={p} aiEnabled={aiEnabled} />}
          {step.key === "delanalyser" && <IssueAnalysesStep project={p} aiEnabled={features.ai.analysisEnabled} />}
          {step.key === "analys" && <AnalysisStep project={p} aiEnabled={features.ai.analysisEnabled} />}

          <footer className="mt-10 flex justify-between border-t border-line pt-4">
            {prev ? (
              <Link to={`/utredning/${id}/${prev.key}`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
                <ArrowLeft className="size-4" /> {prev.label}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link
                to={`/utredning/${id}/${next.key}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
              >
                {next.label} <ArrowRight className="size-4" />
              </Link>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}
