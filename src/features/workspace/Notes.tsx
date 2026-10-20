import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { NotebookPen, X } from "lucide-react";
import { notesApi } from "@/api/client";
import { formatDateTime } from "@/lib/format";
import { NOTE_MAX, type SourceNote } from "../../../shared/notes";

/** Alla anteckningar i utredningen (en per rättskälla). */
export function useNotes(projectId: number) {
  return useQuery({ queryKey: ["notes", projectId], queryFn: () => notesApi.list(projectId), staleTime: 60_000 });
}

/** Knapp i läsytans verktygsrad – prick när källan har en anteckning. */
export function NotesButton({ open, hasNote, onClick }: { open: boolean; hasNote: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={open}
      title={open ? "Dölj anteckningar" : "Anteckningar om källan"}
      aria-label="Anteckningar om källan"
      className={clsx("relative rounded p-1.5 hover:bg-sunken hover:text-ink", open ? "text-accent" : "text-muted")}
    >
      <NotebookPen className="size-4" />
      {hasNote && <span className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" aria-hidden />}
    </button>
  );
}

/**
 * Anteckningar om en rättskälla i utredningen. Sparas automatiskt (efter en kort paus) och syns
 * för alla som arbetar med utredningen.
 */
export function NotesPanel({ projectId, sourceKey, sourceName, note, onClose }: { projectId: number; sourceKey: string; sourceName: string; note?: SourceNote; onClose: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState(note?.text ?? "");
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useMutation({
    mutationFn: (t: string) => notesApi.save(projectId, sourceKey, t),
    onSuccess: (saved) => {
      setDirty(false);
      qc.setQueryData<SourceNote[]>(["notes", projectId], (prev = []) => {
        const rest = prev.filter((n) => n.sourceKey !== sourceKey);
        return saved ? [saved, ...rest] : rest;
      });
    },
  });

  // Byter man flik följer texten med den nya källan.
  useEffect(() => {
    setText(note?.text ?? "");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey]);

  function change(v: string) {
    setText(v);
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save.mutate(v), 900);
  }
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const status = save.isPending
    ? "Sparar…"
    : save.isError
      ? "Kunde inte spara – försök igen"
      : dirty
        ? "Ändrad"
        : note
          ? `Sparad ${formatDateTime(note.updatedAt)}${note.updatedBy ? ` av ${note.updatedBy}` : ""}`
          : "Sparas automatiskt";

  return (
    <section className="border-t border-line bg-sunken/40 px-4 py-2.5" aria-label={`Anteckningar om ${sourceName}`}>
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        <NotebookPen className="size-3.5 text-muted" aria-hidden />
        <p className="font-medium">Anteckningar om {sourceName}</p>
        <span className={clsx("ml-auto", save.isError ? "text-danger" : "text-muted")} aria-live="polite">
          {status}
        </span>
        <button onClick={onClose} aria-label="Dölj anteckningar" className="rounded p-0.5 text-muted hover:bg-surface hover:text-ink">
          <X className="size-3.5" />
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => change(e.target.value)}
        onBlur={() => dirty && !save.isPending && save.mutate(text)}
        maxLength={NOTE_MAX}
        rows={4}
        placeholder="Egna anteckningar om källan – vad som är relevant, vad som ska kontrolleras …"
        className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-sm leading-6 placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />
    </section>
  );
}
