import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { projectsApi } from "@/api/client";
import type { ProjectDetailDto, TextItemDto } from "@/api/types";
import { Button, Card, EmptyState, ErrorNote, Input, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { useRagStream } from "@/lib/useRagStream";
import { buildSuggestPrompt, parseSuggestions, type SuggestKind } from "../suggest";
import { useMainPrompt } from "../useSettings";

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

interface Suggestion {
  id: number;
  text: string;
  state: "new" | "editing" | "added";
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
  const mainPrompt = useMainPrompt(project.id);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [instruction, setInstruction] = useState("");
  const [showInstruction, setShowInstruction] = useState(false);
  const [addingAll, setAddingAll] = useState(false);
  const hasContext = !!(project.caseOverview?.trim() || project.description?.trim());

  async function generate() {
    setSuggestions(null);
    try {
      const res = await rag.run(buildSuggestPrompt(kind, project, instruction, mainPrompt));
      setSuggestions(parseSuggestions(res.content, existing.map((e) => e.text)).map((text, i) => ({ id: i, text, state: "new" })));
    } catch {
      /* felet visas via rag.error */
    }
  }

  function patch(id: number, changes: Partial<Suggestion>) {
    setSuggestions((list) => list?.map((s) => (s.id === id ? { ...s, ...changes } : s)) ?? null);
  }

  async function accept(s: Suggestion, text = s.text) {
    const clean = text.trim();
    if (!clean) return;
    await onAdd(clean);
    patch(s.id, { text: clean, state: "added" });
  }

  async function acceptAll() {
    if (!suggestions) return;
    setAddingAll(true);
    try {
      for (const s of suggestions) if (s.state === "new") await accept(s);
    } finally {
      setAddingAll(false);
    }
  }

  const pending = suggestions?.filter((s) => s.state === "new") ?? [];

  return (
    <Card className="bg-accent-soft/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="size-4 text-accent" aria-hidden /> Förslag från Lawla
          </p>
          <p className="text-xs text-muted">
            {hasContext
              ? `Bygger på ärendebeskrivningen${mainPrompt ? ", din instruktion till Lawla" : ""} och det du redan lagt in. Redigera gärna innan du lägger till.`
              : "Fyll i ärendebeskrivningen först för bättre förslag."}
          </p>
        </div>
        <div className="flex gap-2">
          {!rag.running && (
            <Button size="sm" variant="ghost" onClick={() => setShowInstruction((v) => !v)} disabled={!hasContext}>
              {showInstruction ? "Dölj instruktion" : "Styr förslagen"}
            </Button>
          )}
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
      </div>

      {showInstruction && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void generate();
          }}
        >
          <Input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="T.ex. Fokusera på jämkning, eller: formulera kortare och mer konkret"
            aria-label="Instruktion till Lawla"
            className="h-9"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={rag.running || !hasContext}>
            Ge förslag
          </Button>
        </form>
      )}

      {rag.running && <p className="mt-3 animate-pulse text-sm text-muted">{rag.status || "Tänker…"}</p>}
      {rag.error != null && (
        <div className="mt-3">
          <ErrorNote error={rag.error} />
        </div>
      )}
      {suggestions && suggestions.length === 0 && !rag.running && (
        <p className="mt-3 text-sm text-muted">Inga nya förslag – prova att utveckla ärendebeskrivningen eller ge en instruktion.</p>
      )}
      {suggestions && suggestions.length > 0 && (
        <>
          <ul className="mt-3 space-y-2">
            {suggestions.map((s) => (
              <SuggestionRow
                key={s.id}
                suggestion={s}
                onEdit={() => patch(s.id, { state: "editing" })}
                onCancel={() => patch(s.id, { state: "new" })}
                onAccept={(text) => void accept(s, text)}
                onDismiss={() => setSuggestions((list) => list?.filter((x) => x.id !== s.id) ?? null)}
              />
            ))}
          </ul>
          {pending.length > 1 && (
            <div className="mt-3 flex justify-end">
              <Button size="sm" variant="ghost" loading={addingAll} onClick={() => void acceptAll()}>
                Lägg till alla ({pending.length})
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function SuggestionRow({
  suggestion: s,
  onEdit,
  onCancel,
  onAccept,
  onDismiss,
}: {
  suggestion: Suggestion;
  onEdit: () => void;
  onCancel: () => void;
  onAccept: (text: string) => void;
  onDismiss: () => void;
}) {
  const [text, setText] = useState(s.text);

  if (s.state === "editing") {
    return (
      <li className="rounded-md bg-surface px-3 py-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          autoFocus
          aria-label="Redigera förslag"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onAccept(text);
            }
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="mt-2 flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Avbryt
          </Button>
          <Button size="sm" variant="secondary" icon={<Check className="size-3.5" />} onClick={() => onAccept(text)} disabled={!text.trim()}>
            Lägg till
          </Button>
        </div>
      </li>
    );
  }

  const added = s.state === "added";
  return (
    <li className={`group flex items-start gap-3 rounded-md bg-surface px-3 py-2 ${added ? "opacity-60" : ""}`}>
      <p className="flex-1 text-sm">{s.text}</p>
      {added ? (
        <span className="flex items-center gap-1 text-xs text-ok">
          <Check className="size-3.5" /> Tillagd
        </span>
      ) : (
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setText(s.text);
              onEdit();
            }}
            aria-label="Redigera förslaget"
            title="Redigera innan du lägger till"
            className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
          >
            <Pencil className="size-3.5" />
          </button>
          <button onClick={onDismiss} aria-label="Ta bort förslaget" title="Inte relevant" className="rounded p-1 text-muted hover:bg-sunken hover:text-danger">
            <X className="size-3.5" />
          </button>
          <Button size="sm" variant="secondary" onClick={() => onAccept(s.text)}>
            Lägg till
          </Button>
        </div>
      )}
    </li>
  );
}
