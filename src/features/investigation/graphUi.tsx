/** Gemensamma färger och ikoner för relationsgrafen och täckningsmatrisen. */
import { AlertTriangle, CircleAlert, Info } from "lucide-react";
import clsx from "clsx";
import type { GraphNode, SourceKind, WarningLevel } from "./graph";

export const SOURCE_COLORS: Record<SourceKind, string> = {
  lagrum: "var(--g-lagrum)",
  praxis: "var(--g-praxis)",
  forarbeten: "var(--g-forarbeten)",
  doktrin: "var(--g-doktrin)",
  ovrigt: "var(--g-ovrigt)",
};

export function nodeFill(n: GraphNode): string {
  if (n.kind === "issue") return "var(--accent)";
  if (n.kind === "analysis") return "var(--ink)";
  if (n.kind === "missing" || n.kind === "suggested") return "var(--surface)";
  return SOURCE_COLORS[n.sourceKind ?? "ovrigt"];
}

export const LEVEL_COLOR: Record<WarningLevel, string> = { danger: "var(--danger)", warn: "var(--warn)", info: "var(--muted)" };

const LEVEL_LABEL: Record<WarningLevel, string> = { danger: "Allvarligt", warn: "Varning", info: "Notering" };

export function LevelIcon({ level, className = "size-3.5" }: { level: WarningLevel; className?: string }) {
  const Icon = level === "danger" ? AlertTriangle : level === "warn" ? CircleAlert : Info;
  return <Icon className={clsx("shrink-0", className)} style={{ color: LEVEL_COLOR[level] }} aria-label={LEVEL_LABEL[level]} />;
}
