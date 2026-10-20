/**
 * Rapporten – hela rättsutredningen som ett dokument. Byggs som markdown så att
 * samma text kan visas på skärm (med klickbara hänvisningar), skrivas ut som PDF
 * och exporteras till Word.
 */
import type { ExpandedEvidenceDto, LegalIssueAnalysisDto, ProjectAnalysisDto, ProjectDetailDto } from "@/api/types";
import { demoteHeadings } from "@/lib/mdblocks";
import { assessGraph, buildGraph, buildMatrix, SOURCE_KIND_LABELS } from "./graph";

export interface ReportInput {
  project: ProjectDetailDto;
  evidence: ExpandedEvidenceDto[];
  /** Senaste delanalys per rättsfråga (id → analys). */
  issueAnalyses: Map<number, LegalIssueAnalysisDto>;
  analysis: ProjectAnalysisDto | null;
  /** Datum för rapporten, t.ex. "19 oktober 2026". */
  date: string;
  /** Namn på den som tar fram rapporten (visas i sidhuvudet). */
  author?: string | null;
}

export interface ReportSection {
  key: string;
  title: string;
  included: boolean;
}

export const REPORT_SECTIONS: ReportSection[] = [
  { key: "case", title: "Ärendet", included: true },
  { key: "questions", title: "Klientens frågor", included: true },
  { key: "circumstances", title: "Omständigheter", included: true },
  { key: "issues", title: "Rättsfrågor", included: true },
  { key: "sources", title: "Rättskällor", included: true },
  { key: "issueAnalyses", title: "Analys per rättsfråga", included: true },
  { key: "analysis", title: "Samlad analys", included: true },
  { key: "coverage", title: "Källtäckning och kontroll", included: true },
];

function sorted<T extends { sortOrder: number; id: number }>(items: T[] | null | undefined): T[] {
  return [...(items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

function numbered(items: { text: string | null }[]): string {
  if (items.length === 0) return "_Inga poster._";
  return items.map((it, i) => `${i + 1}. ${(it.text ?? "").trim()}`).join("\n");
}

export function evidenceLabel(e: ExpandedEvidenceDto): string {
  return e.displayLabel || e.documentTitle || `Källa ${e.id}`;
}

export function buildReportMarkdown(input: ReportInput, include: Set<string> = new Set(REPORT_SECTIONS.map((s) => s.key))): string {
  const { project, evidence, issueAnalyses, analysis } = input;
  const out: string[] = [];
  let n = 0;
  const section = (title: string) => `## ${++n}. ${title}`;

  out.push(`# ${project.title?.trim() || "Rättsutredning"}`);
  out.push(`_Rättsutredning · utkast ${input.date}${input.author ? ` · ${input.author}` : ""}_`);
  if (project.description?.trim()) out.push(project.description.trim());

  if (include.has("case")) {
    out.push(section("Ärendet"));
    out.push(project.caseOverview?.trim() || "_Ingen ärendebeskrivning._");
  }
  if (include.has("questions")) {
    out.push(section("Klientens frågor"));
    out.push(numbered(sorted(project.questions)));
  }
  if (include.has("circumstances")) {
    out.push(section("Omständigheter"));
    out.push(numbered(sorted(project.circumstances)));
  }
  const issues = sorted(project.legalIssues);
  if (include.has("issues")) {
    out.push(section("Rättsfrågor"));
    out.push(numbered(issues));
  }
  if (include.has("sources")) {
    out.push(section("Rättskällor"));
    if (evidence.length === 0) out.push("_Inga rättskällor kopplade._");
    else
      out.push(
        evidence
          .map((e, i) => {
            const title = e.documentTitle && e.displayLabel && !e.displayLabel.includes(e.documentTitle) ? ` (${e.documentTitle})` : "";
            const note = e.annotation?.trim() ? `\n   _${e.annotation.trim()}_` : "";
            return `${i + 1}. ${evidenceLabel(e)}${title}${note}`;
          })
          .join("\n"),
      );
  }
  if (include.has("issueAnalyses")) {
    out.push(section("Analys per rättsfråga"));
    if (issues.length === 0) out.push("_Inga rättsfrågor._");
    issues.forEach((issue, i) => {
      out.push(`### ${n}.${i + 1} ${(issue.text ?? "").trim()}`);
      const a = issueAnalyses.get(issue.id);
      out.push(a?.outputContent?.trim() ? demoteHeadings(a.outputContent.trim(), 3) : "_Ingen delanalys framtagen._");
    });
  }
  if (include.has("analysis")) {
    out.push(section("Samlad analys"));
    out.push(analysis?.outputContent?.trim() ? demoteHeadings(analysis.outputContent.trim(), 2) : "_Ingen samlad analys framtagen._");
  }

  if (include.has("coverage")) {
    out.push(section("Källtäckning och kontroll"));
    out.push(buildCoverageMarkdown(input));
  }

  out.push("---");
  out.push("_AI-genererat utkast från Lawla. Hänvisningar och slutsatser ska kontrolleras av ansvarig jurist innan dokumentet används i rådgivning._");
  return out.join("\n\n") + "\n";
}

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/**
 * Avsnittet "Källtäckning och kontroll": vilka rättskällor varje analys hänvisar till (tabell),
 * hänvisningar som saknas i underlaget, oanvända källor och anmärkningar per rättsfråga.
 */
export function buildCoverageMarkdown(input: Pick<ReportInput, "project" | "evidence" | "issueAnalyses" | "analysis">): string {
  const graph = buildGraph({ project: input.project, evidence: input.evidence, issueAnalyses: input.issueAnalyses, analysis: input.analysis });
  const { columns, rows, missing, unused } = buildMatrix(graph);
  const warnings = assessGraph(graph, input);
  if (columns.length === 0) return "_Inga rättsfrågor att redovisa._";

  const out: string[] = [];
  out.push(
    `Tabellen visar hur många gånger varje delanalys${columns.some((c) => c.kind === "analysis") ? " och den samlade analysen" : ""} hänvisar till respektive rättskälla. ` +
      "Hänvisningarna har matchats automatiskt mot underlaget och ska kontrolleras.",
  );
  out.push(columns.map((c) => `- **${c.short}** ${cell(c.kind === "analysis" ? "Samlad analys" : c.label)}`).join("\n"));

  if (rows.length === 0 && missing.length === 0) out.push("_Ingen analys hänvisar till underlaget ännu._");
  else {
    const header = `| Rättskälla | Typ | ${columns.map((c) => c.short).join(" | ")} |`;
    const sep = `| --- | --- | ${columns.map(() => ":---:").join(" | ")} |`;
    const line = (label: string, type: string, cells: number[]) => `| ${cell(label)} | ${type} | ${cells.map((n) => (n > 0 ? String(n) : "–")).join(" | ")} |`;
    out.push(
      [
        header,
        sep,
        ...rows.map((r) => line(r.node.label, SOURCE_KIND_LABELS[r.node.sourceKind ?? "ovrigt"], r.cells)),
        ...missing.map((r) => line(`${r.node.label} (saknas i underlaget)`, "–", r.cells)),
      ].join("\n"),
    );
  }

  if (missing.length > 0)
    out.push(
      `**Hänvisningar som saknas i underlaget:** ${missing
        .map((r) => `${r.node.label} (${columns.filter((_, i) => (r.cells[i] ?? 0) > 0).map((c) => c.short).join(", ")})`)
        .join("; ")}. Kontrollera dem innan utredningen används.`,
    );
  if (unused.length > 0) out.push(`**Rättskällor som inte används av någon analys:** ${unused.map((n) => n.label).join("; ")}.`);

  const notes = columns
    .map((c) => ({ c, list: (warnings.get(c.id) ?? []).filter((w) => w.code !== "missing") }))
    .filter((x) => x.list.length > 0);
  if (notes.length > 0) {
    out.push("**Anmärkningar:**");
    out.push(notes.map(({ c, list }) => `- **${c.short}:** ${list.map((w) => w.text).join(" ")}`).join("\n"));
  } else out.push("_Inga anmärkningar utöver ovanstående._");
  return out.join("\n\n");
}
