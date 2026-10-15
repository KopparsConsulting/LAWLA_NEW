import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { projectsApi } from "@/api/client";
import type { ProjectDetailDto, TextItemDto } from "@/api/types";
import { Button, Card, EmptyState, ErrorNote, Input } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useRagStream } from "@/lib/useRagStream";
import { buildSuggestPrompt, parseSuggestions, type SuggestKind } from "../suggest";

interface Props {
  project: ProjectDetailDto;
  kind: SuggestKind;
  items: TextItemDto[];
  aiEnabled: boolean;
  placeholder: string;
  emptyText: string;
}

export function ItemsStep({ project, kind, items, aiEnabled, placeholder, emptyText }: Props) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["project", project.id];
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const [draft, setDraft] = useState("");

  const add = useMutation({
    mutationFn: (text: string) => projectsApi.addItem(project.id, kind, text),
    onSuccess: () => void refresh(),
    onError: (e) => toast(e.message, "error"),
  });
  const update = useMutation({
    mutationFn: ({ id, text }: { id: number; text: string }) => projectsApi.updateItem(project.id, kind, id, text),
    onSuccess: () => void refresh(),
    onError: (e) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => projectsApi.removeItem(project.id, kind, id),
    onSuccess: () => void refresh(),
    onError: (e) => toast(e.message, "error"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    add.mutate(text, { onSuccess: () => setDraft("") });
  }

  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {sorted.length === 0 && <EmptyState title="Inget här ännu">{emptyText}</EmptyState>}
        {sorted.map((item, i) => (
          <ItemRow
            key={item.id}
            index={i + 1}
            item={item}
            onSave={(text) => update.mutate({ id: item.id, text })}
            onDelete={() => remove.mutate(item.id)}
          />
        ))}
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} aria-label="Ny post" />
        <Button type="submit" variant="secondary" icon={<Plus className="size-4" />} loading={add.isPending} disabled={!draft.trim()}>
          Lägg till
        </Button>
      </form>

      {aiEnabled && <Suggestions project={project} kind={kind} existing={items} onAdd={(t) => add.mutateAsync(t)} />}
    </div>
  );
}

function ItemRow({ index, item, onSave, onDelete }: { index: number; item: TextItemDto; onSave: (t: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text ?? "");

  function save() {
    if (text.trim() && text.trim() !== item.text) onSave(text.trim());
    setEditing(false);
  }

  return (
    <div className="group flex items-start gap-3 rounded-md border border-line bg-surface px-3 py-2.5">
      <span className="mt-0.5 w-5 shrink-0 text-right font-serif text-sm text-muted">{index}.</span>
      {editing ? (
        <>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-8"
            autoFocus
          />
          <button onClick={save} aria-label="Spara" className="mt-1.5 text-ok">
            <Check className="size-4" />
          </button>
          <button onClick={() => setEditing(false)} aria-label="Avbryt" className="mt-1.5 text-muted">
            <X className="size-4" />
          </button>
        </>
      ) : (
        <>
          <p className="flex-1 text-sm leading-relaxed">{item.text}</p>
          <div className="flex gap-1 opacity-60 transition group-hover:opacity-100">
            <button
              onClick={() => {
                setText(item.text ?? "");
                setEditing(true);
              }}
              aria-label="Redigera"
              className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
            >
              <Pencil className="size-3.5" />
            </button>
            <button onClick={onDelete} aria-label="Ta bort" className="rounded p-1 text-muted hover:bg-sunken hover:text-danger">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Suggestions({
  project,
  kind,
  existing,
  onAdd,
}: {
  project: ProjectDetailDto;
  kind: SuggestKind;
  existing: TextItemDto[];
  onAdd: (text: string) => Promise<unknown>;
}) {
  const rag = useRagStream();
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const hasContext = !!(project.caseOverview?.trim() || project.description?.trim());

  async function generate() {
    setSuggestions(null);
    setAdded(new Set());
    try {
      const res = await rag.run(buildSuggestPrompt(kind, project));
      setSuggestions(parseSuggestions(res.content, existing.map((e) => e.text)));
    } catch {
      /* felet visas via rag.error */
    }
  }

  async function accept(text: string) {
    await onAdd(text);
    setAdded((s) => new Set(s).add(text));
  }

  return (
    <Card className="bg-accent-soft/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="size-4 text-accent" aria-hidden /> Förslag från Lawla
          </p>
          <p className="text-xs text-muted">
            {hasContext ? "Bygger på ärendebeskrivningen och det du redan lagt in. Granska innan du lägger till." : "Fyll i ärendebeskrivningen först för bättre förslag."}
          </p>
        </div>
        {rag.running ? (
          <Button size="sm" variant="secondary" onClick={rag.stop}>
            Avbryt
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={generate} disabled={!hasContext}>
            {suggestions ? "Nya förslag" : "Ge förslag"}
          </Button>
        )}
      </div>

      {rag.running && <p className="mt-3 animate-pulse text-sm text-muted">{rag.status || "Tänker…"}</p>}
      {rag.error != null && (
        <div className="mt-3">
          <ErrorNote error={rag.error} />
        </div>
      )}
      {suggestions && suggestions.length === 0 && !rag.running && (
        <p className="mt-3 text-sm text-muted">Inga nya förslag – prova att utveckla ärendebeskrivningen.</p>
      )}
      {suggestions && suggestions.length > 0 && (
        <ul className="mt-3 space-y-2">
          {suggestions.map((s) => {
            const isAdded = added.has(s);
            return (
              <li key={s} className="flex items-start gap-3 rounded-md bg-surface px-3 py-2">
                <p className="flex-1 text-sm">{s}</p>
                <Button size="sm" variant={isAdded ? "ghost" : "secondary"} disabled={isAdded} onClick={() => void accept(s)}>
                  {isAdded ? "Tillagd" : "Lägg till"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
