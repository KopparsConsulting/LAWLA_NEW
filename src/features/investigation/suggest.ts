import type { ProjectDetailDto } from "@/api/types";

export type SuggestKind = "questions" | "circumstances" | "legal-issues";

const KIND_TEXT: Record<SuggestKind, { what: string; guidance: string }> = {
  questions: {
    what: "klientens frågor",
    guidance: "Formulera de konkreta frågor klienten vill ha besvarade, sett ur klientens perspektiv.",
  },
  circumstances: {
    what: "rättsligt relevanta omständigheter",
    guidance:
      "Lista sakomständigheter som framgår av ärendebeskrivningen och som kan ha rättslig betydelse. Hitta inte på fakta – formulera hellre det som är oklart som en omständighet att utreda (t.ex. 'Oklart om …').",
  },
  "legal-issues": {
    what: "rättsfrågor",
    guidance:
      "Formulera precisa rättsfrågor som behöver besvaras för att lösa klientens frågor, gärna med hänvisning till aktuell lagregel (t.ex. '12 kap. 3 § ÄktB').",
  },
};

function bullets(items: { text: string | null }[] | null | undefined): string {
  const list = (items ?? []).map((i) => i.text?.trim()).filter(Boolean);
  return list.length ? list.map((t) => `- ${t}`).join("\n") : "(inga ännu)";
}

/** Huvudprompten som ett stycke i en fråga till Lawla, eller inget alls om den är tom. */
export function mainPromptBlock(mainPrompt?: string | null): string[] {
  const text = mainPrompt?.trim();
  return text ? [`Juristens stående instruktion för hela ärendet (följ den i allt du skriver):\n${text}`] : [];
}

/**
 * Bygger frågan som skickas till RAG-endpointen för att ta fram förslag.
 * `instruction` är juristens styrning för just den här omgången, t.ex. "Fokusera på jämkning";
 * `mainPrompt` är ärendets stående huvudprompt.
 */
export function buildSuggestPrompt(kind: SuggestKind, project: ProjectDetailDto, instruction?: string, mainPrompt?: string | null): string {
  const { what, guidance } = KIND_TEXT[kind];
  const steer = instruction?.trim();
  return [
    `Du hjälper en jurist att strukturera en rättsutredning enligt svensk rätt. Föreslå ${what} för ärendet nedan.`,
    guidance,
    ...mainPromptBlock(mainPrompt),
    ...(steer ? [`Juristens instruktion för förslagen: ${steer}`] : []),
    "Svara ENDAST med en JSON-array av strängar på svenska, högst 6 poster, utan annan text. Upprepa inte sådant som redan finns.",
    "",
    `Ärende: ${project.title ?? ""}`,
    `Ärendebeskrivning:\n${project.caseOverview || project.description || "(saknas)"}`,
    `Klientens frågor:\n${bullets(project.questions)}`,
    `Omständigheter:\n${bullets(project.circumstances)}`,
    `Rättsfrågor:\n${bullets(project.legalIssues)}`,
  ].join("\n");
}

/** Plockar ut förslag ur modellens svar – JSON-array i första hand, annars punktlista. */
export function parseSuggestions(text: string, existing: (string | null)[] = []): string[] {
  const seen = new Set(existing.filter(Boolean).map((s) => normalize(s!)));
  let items: string[] = [];

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) items = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      /* fall tillbaka på radtolkning */
    }
  }
  if (items.length === 0) {
    items = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^([-*•]|\d+[.)])\s+/.test(l))
      .map((l) => l.replace(/^([-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, ""));
  }

  const out: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    const key = normalize(item);
    if (item.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 8);
}

function normalize(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[.?!]$/, "").trim();
}

/** Fråga för att hitta rättskällor till utredningens rättsfrågor. */
export function buildSourcesPrompt(project: ProjectDetailDto, focus?: string, mainPrompt?: string | null): string {
  return [
    "Vilka rättskällor (lagrum, förarbeten, praxis och doktrin) är relevanta för följande rättsfråga(or)? Redogör kort och hänvisa till källorna.",
    ...mainPromptBlock(mainPrompt),
    focus ? `Rättsfråga: ${focus}` : `Rättsfrågor:\n${bullets(project.legalIssues)}`,
    `Bakgrund: ${project.caseOverview || project.description || ""}`,
  ].join("\n");
}
