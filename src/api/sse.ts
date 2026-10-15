import type { StreamEvent } from "./types";

/**
 * Inkrementell parser för Server-Sent Events. Tål att händelser delas mitt i
 * mellan chunkar, CRLF-radbrytningar och flerradiga data-fält.
 */
export function createSseParser(onEvent: (event: StreamEvent) => void) {
  let buffer = "";

  function flushBlock(block: string) {
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length === 0) return;
    const payload = dataLines.join("\n");
    if (payload === "[DONE]") {
      onEvent({ type: "done" });
      return;
    }
    try {
      onEvent(JSON.parse(payload) as StreamEvent);
    } catch {
      // Icke-JSON-data tolkas som rå text.
      onEvent({ type: "content", content: payload });
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (block.trim()) flushBlock(block);
      }
    },
    end() {
      if (buffer.trim()) flushBlock(buffer);
      buffer = "";
    },
  };
}
