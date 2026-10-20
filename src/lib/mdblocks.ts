/**
 * Minimal markdown-tolk för export till Word. Täcker det AI-analyserna och rapporten
 * faktiskt använder: rubriker, stycken, punkt- och nummerlistor, citat, avdelare,
 * fet/kursiv text, tabeller (GFM) och länkar (bara länktexten behålls).
 */

export type Inline = { type: "text"; text: string; bold?: boolean; italic?: boolean };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; inlines: Inline[] }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; inlines: Inline[] }
  | { type: "table"; header: Inline[][]; rows: Inline[][][]; align: ("left" | "center" | "right")[] }
  | { type: "hr" };

const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Delar en tabellrad i celler; `\|` räknas som ett tecken i cellen. */
export function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** Tolkar inline-markdown (**fet**, *kursiv*, [text](url), `kod`) till textsegment. */
export function parseInlines(text: string): Inline[] {
  const out: Inline[] = [];
  // Ta bort länkar men behåll texten, och ta bort kodmarkörer.
  const cleaned = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`([^`]*)`/g, "$1");
  const re = /(\*\*\*|___)(.+?)\1|(\*\*|__)(.+?)\3|(\*|_)(.+?)\5/g;
  let last = 0;
  for (const m of cleaned.matchAll(re)) {
    if (m.index! > last) out.push({ type: "text", text: cleaned.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ type: "text", text: m[2], bold: true, italic: true });
    else if (m[4] !== undefined) out.push({ type: "text", text: m[4], bold: true });
    else out.push({ type: "text", text: m[6]!, italic: true });
    last = m.index! + m[0].length;
  }
  if (last < cleaned.length) out.push({ type: "text", text: cleaned.slice(last) });
  return out.filter((i) => i.text.length > 0);
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let inCode = false;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", inlines: parseInlines(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map(parseInlines) });
    list = null;
  };

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li]!;
    const line = raw.trimEnd();
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      flushParagraph();
      flushList();
      continue;
    }
    if (inCode) {
      paragraph.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6, inlines: parseInlines(heading[2]!) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushParagraph();
      flushList();
      blocks.push({ type: "hr" });
      continue;
    }
    if (line.trim().startsWith("|") && TABLE_SEP.test(lines[li + 1] ?? "")) {
      flushParagraph();
      flushList();
      const header = splitRow(line);
      const align = splitRow(lines[li + 1]!).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left") as "left" | "center" | "right");
      const rows: Inline[][][] = [];
      li += 2;
      while (li < lines.length && lines[li]!.trim().startsWith("|")) rows.push(splitRow(lines[li++]!).map(parseInlines));
      li -= 1;
      blocks.push({ type: "table", header: header.map(parseInlines), rows, align });
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      const prev = blocks[blocks.length - 1];
      if (prev?.type === "quote") prev.inlines.push({ type: "text", text: " " }, ...parseInlines(quote[1]!));
      else blocks.push({ type: "quote", inlines: parseInlines(quote[1]!) });
      continue;
    }
    const item = line.match(/^\s*(?:([-*+•])|(\d+)[.)])\s+(.*)$/);
    if (item) {
      flushParagraph();
      const ordered = item[2] !== undefined;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item[3]!);
      continue;
    }
    // Indragen fortsättning på en listpunkt
    if (list && /^\s{2,}/.test(raw)) {
      list.items[list.items.length - 1] += " " + line.trim();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Sänker alla rubriknivåer med `by` steg (max nivå 6), för inbäddade texter. */
export function demoteHeadings(markdown: string, by: number): string {
  return markdown.replace(/^(#{1,6})(\s)/gm, (_, hashes: string, space: string) => "#".repeat(Math.min(6, hashes.length + by)) + space);
}

/** Ren text utan markdown-markörer, t.ex. för förhandsvisning. */
export function plainText(inlines: Inline[]): string {
  return inlines.map((i) => i.text).join("");
}
