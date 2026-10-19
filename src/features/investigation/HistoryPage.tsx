import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bookmark, FlaskConical, History, Minus, Pencil, Plus, Save } from "lucide-react";
import clsx from "clsx";
import { ApiError, historyApi, projectsApi } from "@/api/client";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatDateTime } from "@/lib/format";
import { buildSnapshot, diffSnapshots, type ProjectSnapshot, type SnapshotDiff, type VersionSummary } from "../../../shared/snapshot";

const CURRENT = 0;

export default function HistoryPage() {
  const id = Number(useParams().id);
  const qc = useQueryClient();
  const toast = useToast();

  const project = useQuery({ queryKey: ["project", id], queryFn: () => projectsApi.get(id), enabled: Number.isFinite(id) });
  const evidence = useQuery({ queryKey: ["evidence", id], queryFn: () => projectsApi.evidence(id), enabled: Number.isFinite(id) });
  const analyses = useQuery({ queryKey: ["analyses", id], queryFn: () => projectsApi.analyses(id), enabled: Number.isFinite(id) });
  const versions = useQuery({ queryKey: ["history", id], queryFn: () => historyApi.list(id), enabled: Number.isFinite(id) });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [compareTo, setCompareTo] = useState<number>(CURRENT);
  const [label, setLabel] = useState("");

  const save = useMutation({
    mutationFn: () => historyApi.snapshot(id, { label: label.trim() || undefined, trigger: "manual" }),
    onSuccess: ({ version }) => {
      setLabel("");
      void qc.invalidateQueries({ queryKey: ["history", id] });
      setSelectedId(version.id);
      toast("Versionen är sparad.");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const current: ProjectSnapshot | null = useMemo(
    () => (project.data ? buildSnapshot(project.data, evidence.data ?? [], analyses.data?.length ?? 0) : null),
    [project.data, evidence.data, analyses.data],
  );

  const list = versions.data ?? [];
  const selected = list.find((v) => v.id === selectedId) ?? list[0];
  // Standard: jämför den valda versionen med versionen före; den allra första jämförs med nuläget.
  const selectedIndex = selected ? list.findIndex((v) => v.id === selected.id) : -1;
  const previous = selectedIndex >= 0 ? list[selectedIndex + 1] : undefined;
  const compareWith = compareTo !== CURRENT && list.some((v) => v.id === compareTo) ? compareTo : (previous?.id ?? CURRENT);

  if (!Number.isFinite(id)) return <Navigate to="/" replace />;
  if (project.isLoading) return <Spinner />;
  if (project.error || !project.data) return <ErrorNote error={project.error} onRetry={() => project.refetch()} />;

  const disabled = versions.error instanceof ApiError && versions.error.status === 503;

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <div>
      <Link to={`/utredning/${id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> {project.data.title || "Utredningen"}
      </Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-serif text-3xl leading-tight">
            <History className="size-6 text-accent" aria-hidden /> Historik
          </h1>
          <p className="mt-1 text-sm text-muted">Versioner av ärendet – sparas när du begär det och automatiskt inför varje analys.</p>
        </div>
        {!disabled && (
          <form onSubmit={submit} className="flex gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Etikett, t.ex. Efter klientmöte" aria-label="Etikett" className="w-56" />
            <Button type="submit" icon={<Save className="size-4" />} loading={save.isPending}>
              Spara version
            </Button>
          </form>
        )}
      </div>

      {disabled && (
        <EmptyState title="Versionshistorik är inte aktiverad i den här miljön">Workern saknar databas för historik. Se docs/DEPLOY.md.</EmptyState>
      )}
      {versions.isLoading && <Spinner />}
      {versions.error && !disabled && <ErrorNote error={versions.error} onRetry={() => versions.refetch()} />}
      {versions.data && list.length === 0 && (
        <EmptyState title="Inga versioner ännu">Spara en version nu, så kan du senare se exakt vad som ändrats i ärendet.</EmptyState>
      )}

      {selected && current && (
        <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
          <aside>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Versioner ({list.length})</p>
            <ol className="space-y-1">
              {list.map((v, i) => (
                <li key={v.id}>
                  <button
                    onClick={() => {
                      setSelectedId(v.id);
                      setCompareTo(CURRENT);
                    }}
                    className={clsx(
                      "w-full rounded-md px-3 py-2 text-left text-sm",
                      v.id === selected.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {v.trigger === "analysis" ? <FlaskConical className="size-3.5 shrink-0" aria-hidden /> : <Bookmark className="size-3.5 shrink-0" aria-hidden />}
                      <span className="truncate font-medium">{v.label || (v.trigger === "analysis" ? "Inför analys" : "Sparad version")}</span>
                      {i === 0 && <Badge tone="accent">Senaste</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs opacity-80">
                      {formatDateTime(v.createdAt)} · {v.counts.legalIssues} rättsfrågor · {v.counts.evidence} källor
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>

          <section className="min-w-0">
            <Card className="mb-4 flex flex-wrap items-center gap-3 p-4 text-sm">
              <strong>{versionName(selected)}</strong>
              <span className="text-muted">· {formatDateTime(selected.createdAt)} · jämför med</span>
              <select
                value={compareWith}
                onChange={(e) => setCompareTo(Number(e.target.value))}
                className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
                aria-label="Jämför med"
              >
                {list
                  .filter((v) => v.id !== selected.id)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {versionName(v)} · {formatDateTime(v.createdAt)}
                    </option>
                  ))}
                <option value={CURRENT}>Nuläget</option>
              </select>
            </Card>
            <DiffView projectId={id} selectedId={selected.id} otherId={compareWith} current={current} />
          </section>
        </div>
      )}
    </div>
  );
}

function versionName(v: VersionSummary) {
  return v.label || (v.trigger === "analysis" ? "Inför analys" : "Sparad version");
}

function DiffView({ projectId, selectedId, otherId, current }: { projectId: number; selectedId: number; otherId: number; current: ProjectSnapshot }) {
  const a = useQuery({ queryKey: ["version", projectId, selectedId], queryFn: () => historyApi.get(projectId, selectedId), staleTime: Infinity });
  const b = useQuery({ queryKey: ["version", projectId, otherId], queryFn: () => historyApi.get(projectId, otherId), enabled: otherId !== CURRENT, staleTime: Infinity });

  if (a.isLoading || b.isLoading) return <Spinner />;
  if (a.error || !a.data) return <ErrorNote error={a.error} />;
  if (b.error) return <ErrorNote error={b.error} />;

  // Ändringar visas alltid från äldre till nyare. Nuläget är nyast.
  const toCurrent = otherId === CURRENT;
  const [before, after, afterName] = toCurrent
    ? [a.data.snapshot, current, "nuläget"]
    : otherId < selectedId
      ? [b.data!.snapshot, a.data.snapshot, "den valda versionen"]
      : [a.data.snapshot, b.data!.snapshot, "den senare versionen"];
  const diff = diffSnapshots(before, after);

  return (
    <div className="space-y-4">
      {diff.total === 0 ? (
        <EmptyState title="Inga skillnader">{toCurrent ? "Ärendet ser ut som i den här versionen." : "Versionerna har samma innehåll."}</EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted">
            {diff.total === 1 ? "1 ändring" : `${diff.total} ändringar`} fram till {afterName}
          </p>
          <DiffBody diff={diff} />
        </>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Hela innehållet i den valda versionen</summary>
        <SnapshotView snapshot={a.data.snapshot} />
      </details>
    </div>
  );
}

function DiffBody({ diff }: { diff: SnapshotDiff }) {
  return (
    <div className="space-y-4">
      {diff.fields.map((f) => (
        <Card key={f.field} className="p-4">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
            <Pencil className="size-3.5 text-muted" aria-hidden /> {f.label}
          </p>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <p className="whitespace-pre-line rounded-md bg-danger/5 p-3 text-muted line-through decoration-danger/40">{f.before || "—"}</p>
            <p className="whitespace-pre-line rounded-md bg-ok/10 p-3">{f.after || "—"}</p>
          </div>
        </Card>
      ))}
      {diff.lists.map((l) => (
        <Card key={l.kind} className="p-4">
          <p className="mb-2 text-sm font-medium">{l.label}</p>
          <ul className="space-y-1.5 text-sm">
            {l.added.map((t, i) => (
              <li key={`a${i}`} className="flex gap-2 rounded-md bg-ok/10 px-3 py-1.5">
                <Plus className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> <span>{t}</span>
              </li>
            ))}
            {l.changed.map((c, i) => (
              <li key={`c${i}`} className="rounded-md bg-accent-soft/60 px-3 py-1.5">
                <span className="flex gap-2">
                  <Pencil className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  <span>
                    <span className="text-muted line-through">{c.before}</span>
                    <br />
                    {c.after}
                  </span>
                </span>
              </li>
            ))}
            {l.removed.map((t, i) => (
              <li key={`r${i}`} className="flex gap-2 rounded-md bg-danger/5 px-3 py-1.5 text-muted">
                <Minus className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden /> <span className="line-through">{t}</span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {diff.analyses.before !== diff.analyses.after && (
        <p className="text-sm text-muted">
          Samlade analyser: {diff.analyses.before} → {diff.analyses.after}
        </p>
      )}
    </div>
  );
}

function SnapshotView({ snapshot }: { snapshot: ProjectSnapshot }) {
  const sections: [string, string[]][] = [
    ["Klientens frågor", snapshot.questions.map((q) => q.text)],
    ["Omständigheter", snapshot.circumstances.map((c) => c.text)],
    ["Rättsfrågor", snapshot.legalIssues.map((l) => l.text)],
    ["Rättskällor", snapshot.evidence.map((e) => e.label || e.documentTitle || `Källa ${e.id}`)],
  ];
  return (
    <div className="mt-3 space-y-4 rounded-md border border-line p-4">
      <div>
        <p className="font-medium">{snapshot.title || "Namnlös utredning"}</p>
        {snapshot.description && <p className="text-muted">{snapshot.description}</p>}
      </div>
      {snapshot.caseOverview && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Ärendebeskrivning</p>
          <p className="whitespace-pre-line">{snapshot.caseOverview}</p>
        </div>
      )}
      {sections.map(([title, items]) => (
        <div key={title}>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
          {items.length === 0 ? <p className="text-muted">—</p> : <ol className="list-decimal space-y-0.5 pl-5">{items.map((t, i) => <li key={i}>{t}</li>)}</ol>}
        </div>
      ))}
    </div>
  );
}
