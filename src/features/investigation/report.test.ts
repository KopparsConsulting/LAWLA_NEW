import { describe, expect, it } from "vitest";
import type { ProjectDetailDto } from "@/api/types";
import { markdownToDocxBlob } from "@/lib/docxExport";
import { buildReportMarkdown } from "./report";

const project: ProjectDetailDto = {
  id: 7,
  title: "Jämkning av äktenskapsförord",
  description: "Klienten vill veta om förordet håller.",
  caseOverview: "Parterna gifte sig 2015 …",
  status: 0,
  isActive: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  questions: [{ id: 1, text: "Kan förordet jämkas?", sortOrder: 0, createdAt: "" }],
  circumstances: [
    { id: 2, text: "Förordet skrevs samma dag som vigseln", sortOrder: 1, createdAt: "" },
    { id: 3, text: "Ingen juridisk rådgivning", sortOrder: 0, createdAt: "" },
  ],
  legalIssues: [{ id: 4, text: "Är förordet oskäligt enligt 12 kap. 3 § ÄktB?", sortOrder: 0, createdAt: "", analysisCount: 1 }],
  evidence: [],
};

const input = {
  project,
  evidence: [
    { id: 9, type: 0 as const, displayLabel: "Äktenskapsbalk – 12 kap. 3 §", content: null, annotation: "Centralt lagrum", documentId: 1, documentTitle: "Äktenskapsbalk (1987:230)", chunkId: 5, chunkIndex: 2, chapter: "12", paragraph: "3" },
  ],
  issueAnalyses: new Map([[4, { id: 20, legalIssueId: 4, outputContent: "## Bedömning\n\nFörordet kan jämkas enligt 12 kap. 3 § ÄktB.", createdAt: "" }]]),
  analysis: { id: 30, createdAt: "", outputContent: "# Slutsats\n\nFörordet bör jämkas.", inputSummary: null },
  date: "19 oktober 2026",
  author: "Anna Advokat",
};

describe("buildReportMarkdown", () => {
  it("sätter ihop alla avsnitt i ordning med sorterade poster", () => {
    const md = buildReportMarkdown(input);
    expect(md).toContain("# Jämkning av äktenskapsförord");
    expect(md).toContain("_Rättsutredning · utkast 19 oktober 2026 · Anna Advokat_");
    expect(md).toContain("## 3. Omständigheter\n\n1. Ingen juridisk rådgivning\n2. Förordet skrevs samma dag som vigseln");
    expect(md).toContain("## 5. Rättskällor\n\n1. Äktenskapsbalk – 12 kap. 3 § (Äktenskapsbalk (1987:230))\n   _Centralt lagrum_");
    // Inbäddade analyser får sänkta rubriknivåer så att dokumentets struktur hålls ihop.
    expect(md).toContain("### 6.1 Är förordet oskäligt enligt 12 kap. 3 § ÄktB?\n\n##### Bedömning");
    expect(md).toContain("## 7. Samlad analys\n\n### Slutsats");
    expect(md.trim().endsWith("innan dokumentet används i rådgivning._")).toBe(true);
  });

  it("kan utelämna avsnitt och numrerar om", () => {
    const md = buildReportMarkdown(input, new Set(["case", "analysis"]));
    expect(md).toContain("## 1. Ärendet");
    expect(md).toContain("## 2. Samlad analys");
    expect(md).not.toContain("Rättskällor");
  });

  it("exporterar till ett giltigt Word-dokument", async () => {
    const blob = await markdownToDocxBlob(buildReportMarkdown(input), { title: "Test" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(2000);
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("PK");
  });
});
