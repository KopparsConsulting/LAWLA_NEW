import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Plus, X } from "lucide-react";
import { projectsApi } from "@/api/client";
import { Button, Card, EmptyState, ErrorNote, Input, Label, PageHeader, Spinner, Textarea } from "@/components/ui";
import { formatDate } from "@/lib/format";

export default function InvestigationsPage() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: projectsApi.list });
  const [creating, setCreating] = useState(false);

  const sorted = [...(projects.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <>
      <PageHeader
        title="Rättsutredningar"
        subtitle="Varje utredning går från klientens frågor via rättsfrågor och rättskällor till en samlad analys."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            Ny rättsutredning
          </Button>
        }
      />

      {projects.isLoading && <Spinner />}
      {projects.error && <ErrorNote error={projects.error} onRetry={() => projects.refetch()} />}
      {projects.data && sorted.length === 0 && (
        <EmptyState title="Inga rättsutredningar ännu">Starta en ny utredning för att komma igång.</EmptyState>
      )}

      <div className="grid gap-3">
        {sorted.map((p) => (
          <Link key={p.id} to={`/utredning/${p.id}`} className="group">
            <Card className="flex items-center gap-6 p-5 transition group-hover:border-accent/50">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-serif text-lg">{p.title || "Namnlös utredning"}</h2>
                {p.description && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{p.description}</p>}
                <p className="mt-2 text-xs text-muted">
                  {p.questionCount} frågor · {p.circumstanceCount} omständigheter · {p.legalIssueCount} rättsfrågor ·{" "}
                  {p.evidenceCount} källor · uppdaterad {formatDate(p.updatedAt)}
                </p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-accent" />
            </Card>
          </Link>
        ))}
      </div>

      {creating && <CreateDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: () => projectsApi.create({ title: title.trim(), description: description.trim() || null }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/utredning/${p.id}/arende`);
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (title.trim()) create.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="new-title">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-lg bg-surface p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="new-title" className="font-serif text-xl">
            Ny rättsutredning
          </h2>
          <button type="button" onClick={onClose} aria-label="Stäng">
            <X className="size-5 text-muted" />
          </button>
        </div>
        <div>
          <Label htmlFor="p-title">Namn på ärendet</Label>
          <Input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="T.ex. Jämkning av äktenskapsförord" autoFocus required />
        </div>
        <div>
          <Label htmlFor="p-desc">Kort beskrivning (valfritt)</Label>
          <Textarea id="p-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        {create.error && <ErrorNote error={create.error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Avbryt
          </Button>
          <Button type="submit" loading={create.isPending} disabled={!title.trim()}>
            Skapa och börja
          </Button>
        </div>
      </form>
    </div>
  );
}
