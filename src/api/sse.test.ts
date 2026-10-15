import { describe, expect, it } from "vitest";
import { createSseParser } from "./sse";
import type { StreamEvent } from "./types";

function collect(chunks: string[]) {
  const events: StreamEvent[] = [];
  const p = createSseParser((e) => events.push(e));
  chunks.forEach((c) => p.push(c));
  p.end();
  return events;
}

describe("createSseParser", () => {
  it("klarar händelser som delas mellan chunkar", () => {
    const events = collect(['data: {"type":"con', 'tent","content":"Hej"}\n', '\ndata: {"type":"done"}\n\n']);
    expect(events).toEqual([{ type: "content", content: "Hej" }, { type: "done" }]);
  });
  it("hanterar CRLF och sista händelse utan avslutande tomrad", () => {
    const events = collect(['data: {"type":"status","content":"Söker"}\r\n\r\n', 'data: {"type":"done"}']);
    expect(events.map((e) => e.type)).toEqual(["status", "done"]);
  });
  it("tolkar icke-JSON som text och [DONE] som slut", () => {
    const events = collect(["data: ren text\n\n", "data: [DONE]\n\n"]);
    expect(events).toEqual([{ type: "content", content: "ren text" }, { type: "done" }]);
  });
});
