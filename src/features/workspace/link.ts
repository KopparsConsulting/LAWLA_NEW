import { sourceKey, type SourceRef } from "../../../shared/sourceDoc";

/** Adress till arbetsytan, ev. med en källa öppen på ett visst ställe och en vald analys. */
export function workspaceUrl(projectId: number, opts: { source?: SourceRef; anchor?: string | null; analys?: string } = {}): string {
  const p = new URLSearchParams();
  if (opts.source) {
    const key = sourceKey(opts.source);
    p.append("flik", key);
    p.set("aktiv", key);
    if (opts.anchor) p.set("till", opts.anchor);
  }
  if (opts.analys) p.set("analys", opts.analys);
  const q = p.toString();
  return `/utredning/${projectId}/arbetsyta${q ? `?${q}` : ""}`;
}
