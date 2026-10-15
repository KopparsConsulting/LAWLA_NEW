import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import { projectsApi } from "@/api/client";
import type { AddEvidenceRequest, ProjectDetailDto, RagSourceDto } from "@/api/types";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Label, Markdown, Spinner, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useRagStream } from "@/lib/useRagStream";
import { buildSourcesPrompt } from "../suggest";

export function SourcesStep({ project, aiEnabled }: { project: ProjectDetailDto; aiEnabled: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const evidenceKey = ["evidence", project.id];
  const evidence = useQuery({ queryKey: evidenceKey, queryFn: () => projectsApi.evidence(project.id) });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: evidenceKey });
    void qc.invalidateQueries({ queryKey: ["project", project.id] });
  };
  const add = useMutation({
    mutationFn: (body: AddEvidenceRequest) => projectsApi.addEvidence(project.id, body),
    onSuccess: () => {
      refresh();
      toast("Källan är tillagd i underlaget.");
    },
    onError: (e) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: (eid: number) => projectsApi.removeEvidence(project.id, eid),
    onSuccess: refresh,
    onError: (e) => toast(e.message, "error"),
  });

  const usedChunks = new Set((evidence.data ?? []).map((e) => e.chunkId).filter((x): x is number => x != null));

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Underlag i utredningen</h3>
        {evidence.isLoading && <Spinner />}
        {evidence.error && <ErrorNote error={evidence.error} onRetry={() => evidence.refetch()} />}
        {evidence.data?.length === 0 && (
          <EmptyState title="Inga rättskällor kopplade ännu">Sök nedan och lägg till de stycken som bär upp analysen.</EmptyState>
        )}
        <div className="space-y-2">
          {evidence.data?.map((e) => (
            <Card key={e.id} className="p-4">
              <div className="flex items-start gap-3">
                <BookOpen className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {e.documentId ? (
                      <Link to={`/dokument/${e.documentId}${e.chunkId ? `#chunk-${e.chunkId}` : ""}`} className="hover:underline">
                        {e.displayLabel || e.documentTitle || "Källa"}
                      </Link>
                    ) : (
                      e.displayLabel || "Egen källa"
                    )}
                  </p>
                  {e.documentTitle && e.displayLabel && <p className="text-xs text-muted">{e.documentTitle}</p>}
                  {e.content && <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-ink/90">{e.content}</p>}
                  {e.annotation && <p className="mt-2 border-l-2 border-accent/40 pl-3 text-sm italic text-muted">{e.annotation}</p>}
                </div>
                <button onClick={() => remove.mutate(e.id)} aria-label="Ta bort källa" className="rounded p-1 text-muted hover:text-danger">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {aiEnabled && (
        <SourceFinder
          project={project}
          usedChunks={usedChunks}
          onAdd={(src, passageIndex) => {
            const p = src.passages[passageIndex];
            if (!p) return;
            add.mutate({
              documentId: src.documentId,
              chunkId: p.chunkId,
              displayLabel: p.displayLabel ? `${src.title} – ${p.displayLabel}` : src.title,
              content: p.text,
            });
          }}
        />
      )}

      <ManualSource onAdd={(body) => add.mutate(body)} busy={add.isPending} />
    </div>
  );
}

function SourceFinder({
  project,
  usedChunks,
  onAdd,
}: {
  project: ProjectDetailDto;
  usedChunks: Set<number>;
  onAdd: (src: RagSourceDto, passageIndex: number) => void;
}) {
  const rag = useRagStream();
  const issues = project.legalIssues ?? [];
  const [focus, setFocus] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);

  function search(e: FormEvent) {
    e.preventDefault();
    const q = custom.trim() || buildSourcesPrompt(project, focus || undefined);
    void rag.run(q).catch(() => {});
  }

  const { sources, content } = rag.result;

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Hitta rättskällor</h3>
      <Card className="p-4">
        <form onSubmit={search} className="space-y-3">
          {issues.length > 0 && (
            <div>
              <Label htmlFor="focus">Utgå från</Label>
              <select
                id="focus"
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm"
              >
                <option value="">Alla rättsfrågor</option>
                {issues.map((i) => (
                  <option key={i.id} value={i.text ?? ""}>
                    {i.text}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <Label htmlFor="custom">…eller egen sökfråga</Label>
            <Input id="custom" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="T.ex. praxis om oskälighet vid jämkning av äktenskapsförord" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" icon={<Search className="size-4" />} loading={rag.running} disabled={issues.length === 0 && !custom.trim()}>
              Sök
            </Button>
            {rag.running && (
              <Button type="button" variant="ghost" onClick={rag.stop}>
                Avbryt
              </Button>
            )}
          </div>
          {issues.length === 0 && !custom.trim() && <p className="text-xs text-muted">Lägg till rättsfrågor eller skriv en egen sökfråga.</p>}
        </form>
      </Card>

      {rag.running && rag.status && <p className="mt-3 animate-pulse text-sm text-muted">{rag.status}</p>}
      {rag.error != null && (
        <div className="mt-3">
          <ErrorNote error={rag.error} />
        </div>
      )}

      {content && (
        <div className="mt-4">
          <button onClick={() => setShowAnswer((v) => !v)} className="flex items-center gap-1 text-sm font-medium text-accent">
            <ChevronDown className={`size-4 transition ${showAnswer ? "rotate-180" : ""}`} /> Lawlas sammanfattning
          </button>
          {showAnswer && (
            <Card className="mt-2 p-4">
              <Markdown>{content}</Markdown>
            </Card>
          )}
        </div>
      )}

      {sources.length > 0 && (
        <div className="mt-4 space-y-3">
          {sources.map((src) => (
            <Card key={src.documentId} className="p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Link to={`/dokument/${src.documentId}`} className="font-medium hover:underline">
                  {src.title}
                </Link>
                {src.documentType && <Badge>{src.documentType}</Badge>}
              </div>
              <ul className="space-y-2">
                {src.passages.map((p, i) => {
                  const used = usedChunks.has(p.chunkId);
                  return (
                    <li key={p.chunkId} className="rounded-md bg-sunken/60 p-3">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-muted">{p.displayLabel}</span>
                        <Button size="sm" variant={used ? "ghost" : "secondary"} disabled={used} icon={used ? undefined : <Plus className="size-3.5" />} onClick={() => onAdd(src, i)}>
                          {used ? "I underlaget" : "Lägg till"}
                        </Button>
                      </div>
                      <p className="line-clamp-5 text-sm leading-relaxed">{p.text}</p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function ManualSource({ onAdd, busy }: { onAdd: (b: AddEvidenceRequest) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [annotation, setAnnotation] = useState("");

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-accent hover:underline">
        + Lägg till egen källhänvisning
      </button>
    );
  }
  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-sm font-semibold">Egen källhänvisning</h3>
      <div>
        <Label htmlFor="m-label">Hänvisning</Label>
        <Input id="m-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="T.ex. NJA 2018 s. 1036" />
      </div>
      <div>
        <Label htmlFor="m-content">Citat eller sammanfattning (valfritt)</Label>
        <Textarea id="m-content" rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="m-ann">Din kommentar (valfritt)</Label>
        <Input id="m-ann" value={annotation} onChange={(e) => setAnnotation(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button
          loading={busy}
          disabled={!label.trim()}
          onClick={() => {
            onAdd({ displayLabel: label.trim(), content: content.trim() || null, annotation: annotation.trim() || null });
            setLabel("");
            setContent("");
            setAnnotation("");
            setOpen(false);
          }}
        >
          Lägg till
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Avbryt
        </Button>
      </div>
    </Card>
  );
}
