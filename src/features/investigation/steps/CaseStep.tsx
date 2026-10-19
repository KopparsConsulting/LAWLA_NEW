import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { projectsApi, settingsApi } from "@/api/client";
import type { ProjectDetailDto } from "@/api/types";
import { Button, ErrorNote, Input, Label, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";
import { MAIN_PROMPT_MAX } from "../../../../shared/sharing";
import { settingsKey, useSaveMainPrompt } from "../useSettings";

export function CaseStep({ project }: { project: ProjectDetailDto }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [title, setTitle] = useState(project.title ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [overview, setOverview] = useState(project.caseOverview ?? "");

  const dirty =
    title !== (project.title ?? "") || description !== (project.description ?? "") || overview !== (project.caseOverview ?? "");

  const save = useMutation({
    mutationFn: () =>
      projectsApi.update(project.id, {
        title: title.trim() || null,
        description: description.trim() || null,
        caseOverview: overview.trim() || null,
        status: project.status,
      }),
    onSuccess: (updated) => {
      qc.setQueryData(["project", project.id], updated);
      void qc.invalidateQueries({ queryKey: ["projects"] });
      toast("Ärendet är sparat.");
    },
  });

  const remove = useMutation({
    mutationFn: () => projectsApi.remove(project.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      navigate("/", { replace: true });
    },
  });

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Label htmlFor="c-title">Namn på ärendet</Label>
        <Input id="c-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="c-desc">Kort beskrivning</Label>
        <Input id="c-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Visas i listan över utredningar" />
      </div>
      <div>
        <Label htmlFor="c-overview">Ärendebeskrivning</Label>
        <Textarea
          id="c-overview"
          rows={10}
          value={overview}
          onChange={(e) => setOverview(e.target.value)}
          placeholder="Beskriv med egna ord vad som hänt och vad klienten vill uppnå. Ju tydligare beskrivning, desto bättre förslag i nästa steg."
        />
        <p className="mt-1 text-xs text-muted">Beskrivningen används som underlag när Lawla föreslår frågor, omständigheter och rättsfrågor.</p>
      </div>
      {save.error && <ErrorNote error={save.error} />}
      <div className="flex items-center justify-between">
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
          Spara ärendet
        </Button>
        <Button
          variant="danger"
          size="sm"
          loading={remove.isPending}
          onClick={() => {
            if (window.confirm("Ta bort hela rättsutredningen? Det går inte att ångra.")) remove.mutate();
          }}
        >
          Ta bort utredningen
        </Button>
      </div>
      {remove.error && <ErrorNote error={remove.error} />}

      <MainPromptSection projectId={project.id} />
    </div>
  );
}

const MAIN_PROMPT_EXAMPLES = [
  "Skriv för en erfaren jurist: kort, precist och utan att förklara grundläggande begrepp.",
  "Hänvisa alltid till lagrum med kapitel och paragraf, och ange rättsfall med NJA-nummer.",
  "Fokusera på jämkningsfrågan; äganderättsfrågan är redan utredd.",
  "Lyft fram osäkerheter och vad som talar emot klientens position.",
];

/**
 * Huvudprompt: juristens stående instruktion till Lawla för ärendet. Går in i alla förslag
 * (frågor, omständigheter, rättsfrågor, rättskällor) och skickas med till analyserna.
 */
function MainPromptSection({ projectId }: { projectId: number }) {
  const toast = useToast();
  const settings = useQuery({ queryKey: settingsKey(projectId), queryFn: () => settingsApi.get(projectId), staleTime: 5 * 60_000, retry: false });
  const save = useSaveMainPrompt(projectId);
  const [draft, setDraft] = useState("");
  const saved = settings.data?.mainPrompt ?? "";

  // Fyll i fältet när inställningarna laddats (och när de sparats från annat håll).
  useEffect(() => setDraft(saved), [saved]);

  const dirty = draft.trim() !== saved;

  return (
    <section className="rounded-lg border border-line bg-accent-soft/30 p-4 sm:p-5">
      <div className="mb-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 text-accent" aria-hidden /> Instruktion till Lawla
        </h3>
        <p className="mt-1 text-xs text-muted">
          Styr hur Lawla ska arbeta i hela ärendet: ton, djup, vad som ska prioriteras eller undvikas. Instruktionen följer med i alla förslag och
          analyser, och sparas i versionshistoriken.
        </p>
      </div>
      <Label htmlFor="c-main-prompt">Huvudprompt (valfri)</Label>
      <Textarea
        id="c-main-prompt"
        rows={4}
        value={draft}
        maxLength={MAIN_PROMPT_MAX}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="T.ex. Skriv kort och sakligt, hänvisa alltid till lagrum, och fokusera på jämkningsfrågan."
        disabled={settings.isLoading}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {MAIN_PROMPT_EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setDraft((d) => (d.trim() ? `${d.trim()}\n${ex}` : ex))}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
              title="Lägg till som rad i instruktionen"
            >
              + {ex.length > 48 ? `${ex.slice(0, 46)}…` : ex}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">
          {draft.length}/{MAIN_PROMPT_MAX}
        </span>
      </div>
      {settings.error && (
        <p className="mt-2 text-xs text-danger">Instruktionen kunde inte hämtas just nu. Du kan ändå spara en ny.</p>
      )}
      {save.error && <ErrorNote error={save.error} />}
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          loading={save.isPending}
          disabled={!dirty}
          onClick={() => save.mutate(draft, { onSuccess: () => toast(draft.trim() ? "Instruktionen är sparad." : "Instruktionen är borttagen.") })}
        >
          Spara instruktion
        </Button>
        {saved && dirty && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(saved)}>
            Ångra
          </Button>
        )}
      </div>
    </section>
  );
}
