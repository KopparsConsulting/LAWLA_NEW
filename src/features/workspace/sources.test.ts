import { describe, expect, it } from "vitest";
import type { ExpandedEvidenceDto } from "@/api/types";
import { linkifyCitations } from "@/features/investigation/citations";
import { evidenceByAnchor, evidenceLocation, findPassage, searchBlocks, segment } from "./sources";
import { buildRequest } from "./SourceViewer";
import { workspaceUrl } from "./link";

const ev = (over: Partial<ExpandedEvidenceDto>): ExpandedEvidenceDto => ({
  id: 1,
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
  ...over,
});

describe("underlaget i källan", () => {
  it("korpus kopplas till avsnittet, lagen.nu via adressen i kommentaren", () => {
    expect(evidenceLocation(ev({ documentId: 5, chunkId: 9 }))).toEqual({ ref: { kind: "doc", documentId: 5 }, anchor: "chunk-9" });
    expect(evidenceLocation(ev({ annotation: "Viktig.\n\nKälla: lagen.nu https://lagen.nu/2005:716#K4P1 (2026-10-20)." }))).toEqual({
      ref: { kind: "lagen", uri: "https://lagen.nu/2005:716" },
      anchor: "K4P1",
    });
    expect(evidenceLocation(ev({ annotation: "Egen anteckning" }))).toBeNull();
    const m = evidenceByAnchor([ev({ id: 1, documentId: 5, chunkId: 9 }), ev({ id: 2, documentId: 6, chunkId: 1 }), ev({ id: 3, documentId: 5 })], "d5");
    expect([...m.entries()].map(([a, l]) => [a, l.map((e) => e.id)])).toEqual([
      ["chunk-9", [1]],
      ["", [3]],
    ]);
  });

  it("textställe hittas trots annan radbrytning", () => {
    const text = "1 § Avtalsvillkor får jämkas\neller lämnas utan avseende, om villkoret är oskäligt.";
    expect(findPassage(text, "jämkas eller lämnas utan avseende")).toEqual([22, 55]);
    expect(findPassage(text, "finns inte")).toBeNull();
  });

  it("sökning och segment", () => {
    const blocks = [
      { anchor: "a", kind: "text" as const, level: 1, label: null, lagrum: false, text: "Barn och barnets bästa" },
      { anchor: "b", kind: "text" as const, level: 1, label: null, lagrum: false, text: "Inget här" },
    ];
    expect(searchBlocks(blocks, "BARN")).toEqual([
      { anchor: "a", start: 0, end: 4 },
      { anchor: "a", start: 9, end: 13 },
    ]);
    expect(searchBlocks(blocks, "b")).toEqual([]);
    const segs = segment("abcdef", [
      { start: 1, end: 4, kind: "evidence" },
      { start: 2, end: 3, kind: "search" },
    ]);
    expect(segs.map((s) => [s.text, [...s.kinds].sort().join("+")])).toEqual([
      ["a", ""],
      ["b", "evidence"],
      ["c", "evidence+search"],
      ["d", "evidence"],
      ["ef", ""],
    ]);
  });

  it("markering från lagen.nu sparas med adress och blir spårbar i analysen", () => {
    const source = { ref: { kind: "lagen" as const, uri: "https://lagen.nu/2005:716" } } as Parameters<typeof buildRequest>[0];
    const req = buildRequest(source, { first: { anchor: "K4P1", kind: "text", level: 3, label: "4 kap. 1 §", lagrum: true, text: "" }, text: "I de situationer" }, "4 kap. 1 § UtlL", "Relevant");
    expect(req.annotation).toMatch(/^Relevant\n\nKälla: lagen\.nu https:\/\/lagen\.nu\/2005:716#K4P1 \(\d{4}-\d{2}-\d{2}\)\.$/);
    const e = ev({ id: 7, displayLabel: req.displayLabel!, content: req.content!, annotation: req.annotation! });
    expect(evidenceLocation(e)?.anchor).toBe("K4P1");
    const { report } = linkifyCitations("Enligt 4 kap. 1 § utlänningslagen får …", [e]);
    expect(report.citations[0]!.evidenceId).toBe(7);
  });

  it("adress till arbetsytan", () => {
    expect(workspaceUrl(3, { source: { kind: "lagen", uri: "https://lagen.nu/2005:716" }, anchor: "K4P1", analys: "samlad" })).toBe(
      "/utredning/3/arbetsyta?flik=l%2F2005%3A716&aktiv=l%2F2005%3A716&till=K4P1&analys=samlad",
    );
  });
});
