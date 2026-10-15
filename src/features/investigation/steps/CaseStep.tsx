import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { projectsApi } from "@/api/client";
import type { ProjectDetailDto } from "@/api/types";
import { Button, ErrorNote, Input, Label, Textarea } from "@/components/ui";
import { useToast } from "@/components/toast";

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
    </div>
  );
}
