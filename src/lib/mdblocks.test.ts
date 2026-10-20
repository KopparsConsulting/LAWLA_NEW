import { describe, expect, it } from "vitest";
import { demoteHeadings, parseBlocks, parseInlines } from "./mdblocks";

describe("parseInlines", () => {
  it("tolkar fet, kursiv och länkar", () => {
    expect(parseInlines("Se **12 kap. 3 §** och *jämkning* i [NJA 2018 s. 1036](#lawla:evidence:3).")).toEqual([
      { type: "text", text: "Se " },
      { type: "text", text: "12 kap. 3 §", bold: true },
      { type: "text", text: " och " },
      { type: "text", text: "jämkning", italic: true },
      { type: "text", text: " i NJA 2018 s. 1036." },
    ]);
  });
});

describe("parseBlocks", () => {
  it("tolkar rubriker, stycken, listor, citat och avdelare", () => {
    const md = "## Bedömning\n\nFörsta stycket\nfortsätter här.\n\n- punkt ett\n- punkt **två**\n\n1. steg\n2) steg två\n\n> ett citat\n> på två rader\n\n---\n";
    const blocks = parseBlocks(md);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list", "list", "quote", "hr"]);
    expect(blocks[0]).toMatchObject({ level: 2 });
    expect(blocks[1]).toMatchObject({ inlines: [{ text: "Första stycket fortsätter här." }] });
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: "punkt ett" }], [{ text: "punkt " }, { text: "två", bold: true }]] });
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[4]).toMatchObject({ inlines: [{ text: "ett citat" }, { text: " " }, { text: "på två rader" }] });
  });

  it("slår ihop indragna fortsättningsrader i listor", () => {
    const blocks = parseBlocks("- en punkt\n  som fortsätter\n- nästa");
    expect(blocks[0]).toMatchObject({ items: [[{ text: "en punkt som fortsätter" }], [{ text: "nästa" }]] });
  });
});

describe("demoteHeadings", () => {
  it("sänker rubriknivåer men aldrig under 6", () => {
    expect(demoteHeadings("# A\n## B\n###### C", 2)).toBe("### A\n#### B\n###### C");
  });
});

describe("tabeller", () => {
  it("tolkar GFM-tabeller med justering och skyddade lodstreck", () => {
    const blocks = parseBlocks("Före\n\n| Källa | F1 |\n| --- | :---: |\n| **ÄktB** a\\|b | 2 |\n| NJA | – |\n\nEfter");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "table", "paragraph"]);
    const t = blocks[1] as Extract<ReturnType<typeof parseBlocks>[number], { type: "table" }>;
    expect(t.align).toEqual(["left", "center"]);
    expect(t.header.map((c) => c.map((i) => i.text).join(""))).toEqual(["Källa", "F1"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0]![0]).toEqual([{ type: "text", text: "ÄktB", bold: true }, { type: "text", text: " a|b" }]);
  });

  it("tar inte en vanlig rad med lodstreck för en tabell", () => {
    expect(parseBlocks("| bara en rad |").map((b) => b.type)).toEqual(["paragraph"]);
  });
});
