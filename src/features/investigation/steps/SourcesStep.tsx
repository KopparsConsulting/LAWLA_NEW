import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, ChevronDown, MessageSquarePlus, Pencil, Plus, Search, Share2, Trash2 } from "lucide-react";
import { projectsApi } from "@/api/client";
import type { AddEvidenceRequest, ExpandedEvidenceDto, ProjectDetailDto, RagSourceDto } from "@/api/types";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, Label, Markdown, Spinner, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useRagStream } from "@/lib/useRagStream";
import { buildSourcesPrompt } from "../suggest";
import { useMainPrompt } from "../useSettings";
import { LagenFinder } from "../lagen";

export function SourcesStep({ project, aiEnabled }: { project: ProjectDetailDto; aiEnabled: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const evidenceKey = ["evidence", project.id];
  const evidence = useQuery({ queryKey: evidenceKey, queryFn: () => projectsApi.evidence(project.id) });
  // ?sok=… kommer från relationsgrafen: en hänvisning som saknas i underlaget.
  const prefill = useSearchParams()[0].get("sok")?.trim() || "";

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
  const replace = useMutation({
    mutationFn: ({ old, changes }: { old: ExpandedEvidenceDto; changes: { displayLabel: string | null; annotation: string | null } }) =>
      projectsApi.replaceEvidence(project.id, old, changes),
    onSuccess: () => {
      refresh();
      toast("Källan är uppdaterad.");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const usedChunks = new Set((evidence.data ?? []).map((e) => e.chunkId).filter((x): x is number => x != null));

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Underlag i utredningen</h3>
          {(evidence.data?.length ?? 0) > 0 && (
            <Link to={`/utredning/${project.id}/graf`} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <Share2 className="size-3.5" /> Visa som relationsgraf
            </Link>
          )}
        </div>
        {evidence.isLoading && <Spinner />}
        {evidence.error && <ErrorNote error={evidence.error} onRetry={() => evidence.refetch()} />}
        {evidence.data?.length === 0 && (
          <EmptyState title="Inga rättskällor kopplade ännu">Sök nedan och lägg till de stycken som bär upp analysen.</EmptyState>
        )}
        <div className="space-y-2">
          {evidence.data?.map((e) => (
            <EvidenceCard
              key={e.id}
              item={e}
              onRemove={() => remove.mutate(e.id)}
              onSave={(changes) => replace.mutate({ old: e, changes })}
              saving={replace.isPending && replace.variables?.old.id === e.id}
            />
          ))}
        </div>
      </section>

      {aiEnabled && (
        <SourceFinder
          project={project}
          initialQuery={prefill}
          usedChunks={usedChunks}
          onAdd={(src, passageIndex, extra) => {
            const p = src.passages[passageIndex];
            if (!p) return;
            add.mutate({
              documentId: src.documentId,
              chunkId: p.chunkId,
              displayLabel: extra?.displayLabel?.trim() || (p.displayLabel ? `${src.title} – ${p.displayLabel}` : src.title),
              content: p.text,
              annotation: extra?.annotation?.trim() || null,
            });
          }}
        />
      )}

      <LagenFinder projectId={project.id} initialQuery={prefill} />

      <ManualSource onAdd={(body) => add.mutate(body)} busy={add.isPending} initialLabel={prefill} />
    </div>
  );
}

function SourceFinder({
  project,
  initialQuery = "",
  usedChunks,
  onAdd,
}: {
  project: ProjectDetailDto;
  initialQuery?: string;
  usedChunks: Set<number>;
  onAdd: (src: RagSourceDto, passageIndex: number, extra?: { displayLabel?: string; annotation?: string }) => void;
}) {
  const rag = useRagStream();
  const mainPrompt = useMainPrompt(project.id);
  const issues = project.legalIssues ?? [];
  const [focus, setFocus] = useState<string>("");
  const [custom, setCustom] = useState(initialQuery);
  const [showAnswer, setShowAnswer] = useState(false);

  function search(e: FormEvent) {
    e.preventDefault();
    const q = custom.trim() || buildSourcesPrompt(project, focus || undefined, mainPrompt);
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
                {src.passages.map((p, i) => (
                  <PassageRow
                    key={p.chunkId}
                    label={p.displayLabel}
                    defaultLabel={p.displayLabel ? `${src.title} – ${p.displayLabel}` : src.title}
                    text={p.text}
                    used={usedChunks.has(p.chunkId)}
                    onAdd={(extra) => onAdd(src, i, extra)}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

/** Ett textställe i sökresultatet – kan läggas till direkt eller med egen etikett och kommentar. */
function PassageRow({
  label,
  defaultLabel,
  text,
  used,
  onAdd,
}: {
  label: string;
  defaultLabel: string;
  text: string;
  used: boolean;
  onAdd: (extra?: { displayLabel?: string; annotation?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [displayLabel, setDisplayLabel] = useState(defaultLabel);
  const [annotation, setAnnotation] = useState("");

  return (
    <li className="rounded-md bg-sunken/60 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        <div className="flex gap-1">
          {!used && (
            <Button size="sm" variant="ghost" icon={<MessageSquarePlus className="size-3.5" />} onClick={() => setOpen((v) => !v)} title="Lägg till med egen etikett och kommentar">
              Kommentera
            </Button>
          )}
          <Button size="sm" variant={used ? "ghost" : "secondary"} disabled={used} icon={used ? undefined : <Plus className="size-3.5" />} onClick={() => onAdd()}>
            {used ? "I underlaget" : "Lägg till"}
          </Button>
        </div>
      </div>
      <p className="line-clamp-5 text-sm leading-relaxed">{text}</p>
      {open && !used && (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <div>
            <Label htmlFor={`pl-${label}`}>Hänvisning</Label>
            <Input id={`pl-${label}`} value={displayLabel} onChange={(e) => setDisplayLabel(e.target.value)} className="h-9" />
          </div>
          <div>
            <Label htmlFor={`pa-${label}`}>Din kommentar – varför är stycket relevant?</Label>
            <Textarea id={`pa-${label}`} rows={2} value={annotation} onChange={(e) => setAnnotation(e.target.value)} placeholder="T.ex. Stöder att tidpunkten för förordet har betydelse" />
          </div>
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Avbryt
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onAdd({ displayLabel, annotation });
                setOpen(false);
              }}
            >
              Lägg till med kommentar
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** En rättskälla i underlaget – etikett och kommentar kan redigeras i efterhand. */
function EvidenceCard({
  item: e,
  onRemove,
  onSave,
  saving,
}: {
  item: ExpandedEvidenceDto;
  onRemove: () => void;
  onSave: (changes: { displayLabel: string | null; annotation: string | null }) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [displayLabel, setDisplayLabel] = useState(e.displayLabel ?? "");
  const [annotation, setAnnotation] = useState(e.annotation ?? "");

  function startEdit() {
    setDisplayLabel(e.displayLabel ?? "");
    setAnnotation(e.annotation ?? "");
    setEditing(true);
  }

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <div>
                <Label htmlFor={`el-${e.id}`}>Hänvisning</Label>
                <Input id={`el-${e.id}`} value={displayLabel} onChange={(ev) => setDisplayLabel(ev.target.value)} className="h-9" />
              </div>
              <div>
                <Label htmlFor={`ea-${e.id}`}>Din kommentar</Label>
                <Textarea id={`ea-${e.id}`} rows={2} value={annotation} onChange={(ev) => setAnnotation(ev.target.value)} />
              </div>
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Avbryt
                </Button>
                <Button
                  size="sm"
                  loading={saving}
                  disabled={!displayLabel.trim()}
                  onClick={() => {
                    onSave({ displayLabel: displayLabel.trim() || null, annotation: annotation.trim() || null });
                    setEditing(false);
                  }}
                >
                  Spara
                </Button>
              </div>
            </div>
          ) : (
            <>
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
              {e.annotation ? (
                <p className="mt-2 border-l-2 border-accent/40 pl-3 text-sm italic text-muted">{e.annotation}</p>
              ) : (
                <button onClick={startEdit} className="mt-2 text-xs text-muted underline decoration-dotted hover:text-ink">
                  Lägg till en kommentar om varför källan är relevant
                </button>
              )}
            </>
          )}
        </div>
        {!editing && (
          <div className="flex gap-1">
            <button onClick={startEdit} aria-label="Redigera källan" className="rounded p-1 text-muted hover:bg-sunken hover:text-ink">
              <Pencil className="size-4" />
            </button>
            <button onClick={onRemove} aria-label="Ta bort källa" className="rounded p-1 text-muted hover:text-danger">
              <Trash2 className="size-4" />
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

function ManualSource({ onAdd, busy, initialLabel = "" }: { onAdd: (b: AddEvidenceRequest) => void; busy: boolean; initialLabel?: string }) {
  const [open, setOpen] = useState(!!initialLabel);
  const [label, setLabel] = useState(initialLabel);
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
