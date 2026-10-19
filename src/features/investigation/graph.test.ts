import { describe, expect, it } from "vitest";
import type { DocumentReferenceDto, ExpandedEvidenceDto, LegalIssueAnalysisDto, ProjectAnalysisDto, ProjectDetailDto } from "@/api/types";
import { ANALYSIS_NODE_ID, buildGraph, classifySource, graphStats, issueNodeId, layoutGraph, layoutRows, missingNodeId, neighbours, ROW_GAP, sourceNodeId } from "./graph";

function ev(id: number, displayLabel: string, documentTitle: string | null = null, documentId: number | null = null): ExpandedEvidenceDto {
  return { id, type: 0, displayLabel, content: null, annotation: null, documentId, documentTitle, chunkId: null, chunkIndex: null, chapter: null, paragraph: null };
}

const project: ProjectDetailDto = {
  id: 1,
  title: "Jämkning av äktenskapsförord",
  description: null,
  caseOverview: null,
  status: 0,
  isActive: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  questions: [],
  circumstances: [],
  legalIssues: [
    { id: 10, text: "Är förordet oskäligt enligt 12 kap. 3 § ÄktB?", sortOrder: 1, createdAt: "", analysisCount: 1 },
    { id: 11, text: "Kan 36 § AvtL tillämpas?", sortOrder: 2, createdAt: "", analysisCount: 1 },
    { id: 12, text: "Utan analys", sortOrder: 3, createdAt: "", analysisCount: 0 },
  ],
  evidence: [],
};

const evidence = [
  ev(1, "Äktenskapsbalk (1987:230) – 12 kap. 3 §", "Äktenskapsbalk (1987:230)", 100),
  ev(2, "NJA 1993 s. 583", "NJA 1993 s. 583", 200),
  ev(3, "Lag (1915:218) om avtal – 36 §", "Avtalslagen", 300),
  ev(4, "Prop. 1986/87:1", "Prop. 1986/87:1 om äktenskapsbalk", 400),
];

const analysis = (legalIssueId: number, outputContent: string): LegalIssueAnalysisDto => ({ id: legalIssueId * 100, legalIssueId, outputContent, createdAt: "" });

describe("classifySource", () => {
  it("känner igen praxis, förarbeten, lagrum och doktrin", () => {
    expect(classifySource({ displayLabel: "NJA 1993 s. 583", documentTitle: null })).toBe("praxis");
    expect(classifySource({ displayLabel: "Prop. 1986/87:1", documentTitle: null })).toBe("forarbeten");
    expect(classifySource({ displayLabel: "12 kap. 3 § ÄktB", documentTitle: "Äktenskapsbalk (1987:230)" })).toBe("lagrum");
    expect(classifySource({ displayLabel: "Tottie & Teleman, Äktenskapsbalken – en kommentar", documentTitle: null })).toBe("doktrin");
    expect(classifySource({ displayLabel: "Mejl från klienten", documentTitle: null })).toBe("ovrigt");
  });
  it("låter backendens dokumenttyp gå före", () => {
    expect(classifySource({ displayLabel: "Något", documentTitle: null, documentType: "Rättsfall" })).toBe("praxis");
    expect(classifySource({ displayLabel: "Något", documentTitle: null, documentType: "Lag" })).toBe("lagrum");
  });
});

describe("buildGraph", () => {
  const issueAnalyses = new Map<number, LegalIssueAnalysisDto>([
    [10, analysis(10, "Enligt 12 kap. 3 § ÄktB kan förordet jämkas, se NJA 1993 s. 583 och NJA 1993 s. 583 igen. Jfr även NJA 2020 s. 1 som saknas.")],
    [11, analysis(11, "36 § AvtL är tillämplig; se prop. 1986/87:1.")],
  ]);

  it("skapar noder för rättsfrågor och rättskällor och kanter från delanalysernas hänvisningar", () => {
    const g = buildGraph({ project, evidence, issueAnalyses });
    expect(g.nodes.filter((n) => n.kind === "issue")).toHaveLength(3);
    expect(g.nodes.filter((n) => n.kind === "source")).toHaveLength(4);

    const e1 = g.edges.find((e) => e.from === issueNodeId(10) && e.to === sourceNodeId(2));
    expect(e1?.kind).toBe("cites");
    expect(e1?.weight).toBe(2); // NJA 1993 s. 583 nämns två gånger
    expect(g.edges.some((e) => e.from === issueNodeId(10) && e.to === sourceNodeId(1))).toBe(true);
    expect(g.edges.some((e) => e.from === issueNodeId(11) && e.to === sourceNodeId(3))).toBe(true);
    expect(g.edges.some((e) => e.from === issueNodeId(11) && e.to === sourceNodeId(4))).toBe(true);
    expect(g.edges.some((e) => e.from === issueNodeId(12))).toBe(false);
  });

  it("lägger hänvisningar som saknas i underlaget som egna, röda noder", () => {
    const g = buildGraph({ project, evidence, issueAnalyses });
    const missing = g.nodes.filter((n) => n.kind === "missing");
    expect(missing).toHaveLength(1);
    expect(missing[0]!.label).toBe("NJA 2020 s. 1");
    expect(g.edges.some((e) => e.from === issueNodeId(10) && e.to === missingNodeId("NJA 2020 s. 1"))).toBe(true);
  });

  it("väger rättskällor efter hur många gånger de hänvisas till", () => {
    const g = buildGraph({ project, evidence, issueAnalyses });
    expect(g.nodes.find((n) => n.id === sourceNodeId(2))?.weight).toBe(2);
    expect(g.nodes.find((n) => n.id === sourceNodeId(4))?.weight).toBe(1);
  });

  it("tar med samlad analys som egen nod när den finns", () => {
    const overall: ProjectAnalysisDto = { id: 7, createdAt: "", outputContent: "Sammantaget talar 36 § AvtL för jämkning.", inputSummary: null };
    const g = buildGraph({ project, evidence, issueAnalyses, analysis: overall });
    expect(g.nodes.some((n) => n.id === ANALYSIS_NODE_ID)).toBe(true);
    expect(g.edges.some((e) => e.from === ANALYSIS_NODE_ID && e.to === sourceNodeId(3))).toBe(true);
    expect(buildGraph({ project, evidence, issueAnalyses }).nodes.some((n) => n.id === ANALYSIS_NODE_ID)).toBe(false);
  });

  it("ritar streckade korsreferenser mellan källdokument, en per dokumentpar", () => {
    const ref = (targetDocumentId: number, isResolved = true): DocumentReferenceDto => ({
      id: Math.random(),
      canonicalForm: null,
      referenceType: "lag",
      displayText: "12 kap. 3 § ÄktB",
      citationText: null,
      targetDocumentId,
      targetDocumentTitle: "Äktenskapsbalk",
      isResolved,
    });
    const references = new Map<number, DocumentReferenceDto[]>([
      [200, [ref(100), ref(100), ref(999), ref(400, false)]], // NJA → ÄktB (dubblett + okänt dokument + olöst)
      [400, [ref(100)]],
    ]);
    const g = buildGraph({ project, evidence, issueAnalyses, references });
    const refs = g.edges.filter((e) => e.kind === "refers");
    expect(refs).toHaveLength(2);
    expect(refs.some((e) => e.from === sourceNodeId(2) && e.to === sourceNodeId(1))).toBe(true);
    expect(refs.some((e) => e.from === sourceNodeId(4) && e.to === sourceNodeId(1))).toBe(true);
  });

  it("sammanfattar statistik", () => {
    const g = buildGraph({ project, evidence, issueAnalyses });
    expect(graphStats(g)).toEqual({ issues: 3, sources: 4, usedSources: 4, missing: 1, references: 0 });
  });

  it("hittar grannar", () => {
    const g = buildGraph({ project, evidence, issueAnalyses });
    const n = neighbours(g, sourceNodeId(2));
    expect(n.has(issueNodeId(10))).toBe(true);
    expect(n.has(issueNodeId(11))).toBe(false);
  });
});

describe("layoutGraph", () => {
  const issueAnalyses = new Map<number, LegalIssueAnalysisDto>([[10, analysis(10, "Se 12 kap. 3 § ÄktB och NJA 1993 s. 583.")]]);

  it("placerar alla noder inom ytan och är deterministisk", () => {
    const g = buildGraph({ project, evidence, issueAnalyses });
    const a = layoutGraph(g, { width: 800, height: 500 });
    const b = layoutGraph(g, { width: 800, height: 500 });
    expect(a).toHaveLength(g.nodes.length);
    for (const n of a) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(800);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(500);
    }
    expect(a.map((n) => [n.x, n.y])).toEqual(b.map((n) => [n.x, n.y]));
  });

  it("lägger rättsfrågor till vänster om rättskällorna", () => {
    const g = buildGraph({ project, evidence, issueAnalyses });
    const pos = layoutGraph(g, { width: 800, height: 500 });
    const avg = (kind: string) => {
      const list = pos.filter((n) => n.kind === kind);
      return list.reduce((s, n) => s + n.x, 0) / list.length;
    };
    expect(avg("issue")).toBeLessThan(avg("source"));
  });

  it("håller noderna isär", () => {
    const g = buildGraph({ project, evidence, issueAnalyses });
    const pos = layoutGraph(g, { width: 800, height: 80 + layoutRows(g) * ROW_GAP });
    for (let i = 0; i < pos.length; i++)
      for (let j = i + 1; j < pos.length; j++) {
        const d = Math.hypot(pos[i]!.x - pos[j]!.x, pos[i]!.y - pos[j]!.y);
        expect(d).toBeGreaterThan(pos[i]!.r + pos[j]!.r);
      }
  });

  it("sorterar källorna efter vilka rättsfrågor som hänvisar till dem och lägger oanvända sist", () => {
    const two = new Map<number, LegalIssueAnalysisDto>([
      [10, analysis(10, "Se NJA 1993 s. 583.")],
      [11, analysis(11, "Se 12 kap. 3 § ÄktB.")],
    ]);
    const g = buildGraph({ project, evidence, issueAnalyses: two });
    const pos = layoutGraph(g, { width: 800, height: 400 });
    const y = (id: string) => pos.find((n) => n.id === id)!.y;
    expect(y(sourceNodeId(2))).toBeLessThan(y(sourceNodeId(1))); // NJA (fråga 1) ovanför ÄktB (fråga 2)
    expect(y(sourceNodeId(3))).toBeGreaterThan(y(sourceNodeId(1))); // oanvänd AvtL sist
    expect(layoutRows(g)).toBe(4);
  });

  it("klarar en tom graf och en ensam nod", () => {
    expect(layoutGraph({ nodes: [], edges: [] }, { width: 400, height: 300 })).toEqual([]);
    const one = layoutGraph({ nodes: [{ id: "x", kind: "source", label: "x", weight: 0 }], edges: [] }, { width: 400, height: 300 });
    expect(one[0]).toMatchObject({ x: 200, y: 150 });
  });
});
