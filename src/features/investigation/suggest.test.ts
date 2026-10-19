import { describe, expect, it } from "vitest";
import { buildSourcesPrompt, buildSuggestPrompt, mainPromptBlock, parseSuggestions } from "./suggest";
import type { ProjectDetailDto } from "@/api/types";

describe("parseSuggestions", () => {
  it("läser en JSON-array även med text runt", () => {
    expect(parseSuggestions('Här är förslag:\n["Fråga A", "Fråga B"]\nLycka till')).toEqual(["Fråga A", "Fråga B"]);
  });
  it("faller tillbaka på punktlistor", () => {
    expect(parseSuggestions("1. **Första** frågan\n2) Andra frågan\n- Tredje")).toEqual(["Första frågan", "Andra frågan", "Tredje"]);
  });
  it("tar bort dubbletter och sådant som redan finns", () => {
    expect(parseSuggestions('["Kan förordet jämkas?", "kan förordet jämkas", "Ny fråga"]', ["Ny fråga."])).toEqual([
      "Kan förordet jämkas?",
    ]);
  });
});

describe("buildSuggestPrompt", () => {
  it("tar med ärendebeskrivning och befintliga poster", () => {
    const p = {
      id: 1, title: "Jämkning", description: null, caseOverview: "Förord skrevs på bröllopsdagen.", status: 0, isActive: true,
      createdAt: "", updatedAt: "", questions: [{ id: 1, text: "Kan förordet jämkas?", sortOrder: 0, createdAt: "" }],
      circumstances: [], legalIssues: [], evidence: [],
    } satisfies ProjectDetailDto;
    const prompt = buildSuggestPrompt("legal-issues", p);
    expect(prompt).toContain("rättsfrågor");
    expect(prompt).toContain("Förord skrevs på bröllopsdagen.");
    expect(prompt).toContain("- Kan förordet jämkas?");
    expect(prompt).not.toContain("Juristens instruktion");
    expect(buildSuggestPrompt("legal-issues", p, "Fokusera på jämkning")).toContain("Juristens instruktion för förslagen: Fokusera på jämkning");
  });

  it("tar med ärendets huvudprompt före omgångens instruktion", () => {
    const p = {
      id: 1, title: "Jämkning", description: null, caseOverview: "Bakgrund", status: 0, isActive: true,
      createdAt: "", updatedAt: "", questions: [], circumstances: [], legalIssues: [], evidence: [],
    } satisfies ProjectDetailDto;
    const prompt = buildSuggestPrompt("questions", p, "Kortare", "Skriv för en erfaren jurist.");
    expect(prompt).toContain("stående instruktion för hela ärendet");
    expect(prompt).toContain("Skriv för en erfaren jurist.");
    expect(prompt.indexOf("stående instruktion")).toBeLessThan(prompt.indexOf("Juristens instruktion för förslagen: Kortare"));
    expect(buildSuggestPrompt("questions", p, undefined, "   ")).not.toContain("stående instruktion");
    expect(buildSourcesPrompt(p, undefined, "Bara praxis från HD.")).toContain("Bara praxis från HD.");
    expect(mainPromptBlock(null)).toEqual([]);
  });
});
