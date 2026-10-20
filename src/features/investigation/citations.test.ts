import { describe, expect, it } from "vitest";
import type { ExpandedEvidenceDto } from "@/api/types";
import { lawWord, linkifyCitations, parseCitationHref, sentenceAround } from "./citations";

function ev(partial: Partial<ExpandedEvidenceDto> & { id: number }): ExpandedEvidenceDto {
  return {
    type: 0,
    displayLabel: null,
    content: null,
    annotation: null,
    documentId: null,
    documentTitle: null,
    chunkId: null,
    chunkIndex: null,
    chapter: null,
    paragraph: null,
    ...partial,
  };
}

const evidence: ExpandedEvidenceDto[] = [
  ev({ id: 1, documentId: 10, chunkId: 100, documentTitle: "Äktenskapsbalk (1987:230)", displayLabel: "Äktenskapsbalk (1987:230) – 12 kap. 3 §", chapter: "12 kap.", paragraph: "3 §" }),
  ev({ id: 2, documentId: 11, chunkId: 110, documentTitle: "Föräldrabalk (1949:381)", displayLabel: "Föräldrabalk – 6 kap. 2 a §", chapter: "6", paragraph: "2 a" }),
  ev({ id: 3, displayLabel: "NJA 2018 s. 1036" }),
  ev({ id: 4, documentId: 12, documentTitle: "Lag (1915:218) om avtal och andra rättshandlingar på förmögenhetsrättens område", displayLabel: "36 §" }),
  ev({ id: 5, displayLabel: "Prop. 2020/21:123 s. 45" }),
];

describe("lawWord", () => {
  it("känner igen förkortningar och lagnamn", () => {
    expect(lawWord("ÄktB")).toBe("äktenskapsbalk");
    expect(lawWord("äktenskapsbalken")).toBe("äktenskapsbalk");
    expect(lawWord("avtalslagen")).toBe("avtalslag");
    expect(lawWord(undefined)).toBeNull();
  });
});

describe("linkifyCitations", () => {
  it("länkar lagrum med kapitel till rätt underlag", () => {
    const { markdown, report } = linkifyCitations("Enligt 12 kap. 3 § ÄktB kan förordet jämkas.", evidence);
    expect(markdown).toBe("Enligt [12 kap. 3 § ÄktB](#lawla:evidence:1) kan förordet jämkas.");
    expect(report.used.map((e) => e.id)).toEqual([1]);
    expect(report.unmatched).toEqual([]);
  });

  it("länkar lagnamn i klartext och paragrafer med bokstav", () => {
    const { markdown } = linkifyCitations("Se 12 kap. 3 § äktenskapsbalken och 6 kap. 2 a § FB.", evidence);
    expect(markdown).toContain("[12 kap. 3 § äktenskapsbalken](#lawla:evidence:1)");
    expect(markdown).toContain("[6 kap. 2 a § FB](#lawla:evidence:2)");
  });

  it("länkar rättsfall och förarbeten", () => {
    const { markdown } = linkifyCitations("Jfr NJA 2018 s. 1036 och prop. 2020/21:123.", evidence);
    expect(markdown).toContain("[NJA 2018 s. 1036](#lawla:evidence:3)");
    expect(markdown).toContain("[prop. 2020/21:123](#lawla:evidence:5)");
  });

  it("länkar paragraf utan kapitel när lagen går att avgöra", () => {
    const { markdown } = linkifyCitations("Avtalet kan jämkas enligt 36 § AvtL.", evidence);
    expect(markdown).toContain("[36 § AvtL](#lawla:evidence:4)");
  });

  it("flaggar hänvisningar som saknas i underlaget som sök-länkar", () => {
    const { markdown, report } = linkifyCitations("Se NJA 2015 s. 482 och 7 kap. 1 § ÄktB.", evidence);
    expect(markdown).toContain("[NJA 2015 s. 482](#lawla:search:NJA%202015%20s.%20482)");
    expect(markdown).toContain("[7 kap. 1 § ÄktB](#lawla:search:");
    expect(report.unmatched).toEqual(["NJA 2015 s. 482", "7 kap. 1 § ÄktB"]);
    expect(report.unused.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("matchar inte en annan lag med samma kapitel och paragraf", () => {
    const { report } = linkifyCitations("Enligt 12 kap. 3 § BrB.", evidence);
    expect(report.unmatched).toEqual(["12 kap. 3 § BrB"]);
  });

  it("godtar lagrum utan lagnamn bara när det är entydigt", () => {
    const { markdown } = linkifyCitations("Enligt 6 kap. 2 a § gäller …", evidence);
    expect(markdown).toContain("[6 kap. 2 a §](#lawla:evidence:2)");
  });

  it("rör inte kod, befintliga länkar eller rubriker med hänvisningar i länktext", () => {
    const text = "Se [NJA 2018 s. 1036](https://x.se) och `NJA 2018 s. 1036`.";
    expect(linkifyCitations(text, evidence).markdown).toBe(text);
  });

  it("räknar en hänvisning bara en gång i rapporten", () => {
    const { report } = linkifyCitations("NJA 2015 s. 482 … NJA 2015 s. 482 igen.", evidence);
    expect(report.citations).toHaveLength(2);
    expect(report.unmatched).toEqual(["NJA 2015 s. 482"]);
  });
});

describe("parseCitationHref", () => {
  it("tolkar hash-adresserna", () => {
    expect(parseCitationHref("#lawla:evidence:12")).toEqual({ kind: "evidence", evidenceId: 12 });
    expect(parseCitationHref("#lawla:search:NJA%202015%20s.%20482")).toEqual({ kind: "search", query: "NJA 2015 s. 482" });
    expect(parseCitationHref("https://example.com")).toBeNull();
    expect(parseCitationHref(undefined)).toBeNull();
  });
});

describe("sentenceAround", () => {
  it("tar meningen runt hänvisningen utan att dela vid kap., s. eller prop.", () => {
    const md = "Förordet skrevs före vigseln. Enligt **12 kap. 3 § ÄktB** och prop. 1986/87:1 s. 186 kan det jämkas. Nästa mening.";
    const start = md.indexOf("12 kap.");
    expect(sentenceAround(md, start, start + 16)).toBe("Enligt 12 kap. 3 § ÄktB och prop. 1986/87:1 s. 186 kan det jämkas.");
  });

  it("håller sig inom raden och tar bort listmarkörer och länkar", () => {
    const md = "## Rubrik\n\n- Se [NJA 1993 s. 583](https://x) om oskälighet\n- Annat";
    const start = md.indexOf("NJA");
    expect(sentenceAround(md, start, start + 15)).toBe("Se NJA 1993 s. 583 om oskälighet");
  });

  it("kortar långa meningar kring hänvisningen", () => {
    const md = `${"Mycket lång text ".repeat(30)}enligt 36 § AvtL ${"och ännu mer text ".repeat(30)}.`;
    const start = md.indexOf("36 §");
    const out = sentenceAround(md, start, start + 9, 120);
    expect(out.length).toBeLessThanOrEqual(122);
    expect(out).toContain("36 § AvtL");
    expect(out.startsWith("…") && out.endsWith("…")).toBe(true);
  });

  it("följer med i rapporten från linkifyCitations", () => {
    const { report } = linkifyCitations("Inledning. Se NJA 2020 s. 1 här. Slut.", []);
    expect(report.citations[0]!.context).toBe("Se NJA 2020 s. 1 här.");
  });
});
