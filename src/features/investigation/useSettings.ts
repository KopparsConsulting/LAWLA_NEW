import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/api/client";
import type { ProjectSettings } from "../../../shared/sharing";

export const settingsKey = (projectId: number) => ["settings", projectId] as const;

/**
 * Ärendets huvudprompt (juristens stående instruktion till Lawla). Lagras av Workern.
 * Saknas inställningar – eller svarar Workern inte – behandlas prompten som tom så att
 * utredningen fungerar ändå.
 */
export function useMainPrompt(projectId: number): string {
  const q = useQuery({
    queryKey: settingsKey(projectId),
    queryFn: () => settingsApi.get(projectId),
    enabled: Number.isFinite(projectId),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return q.data?.mainPrompt ?? "";
}

export function useSaveMainPrompt(projectId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mainPrompt: string) => settingsApi.save(projectId, mainPrompt),
    onSuccess: (settings: ProjectSettings) => qc.setQueryData(settingsKey(projectId), settings),
  });
}
