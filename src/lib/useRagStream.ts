import { useCallback, useEffect, useRef, useState } from "react";
import { ragApi } from "@/api/client";
import type { ConversationMessage, RagSourceDto, RagToolEntry } from "@/api/types";

export interface RagResult {
  content: string;
  sources: RagSourceDto[];
  followUps: string[];
  tools: RagToolEntry[];
}

const empty: RagResult = { content: "", sources: [], followUps: [], tools: [] };

/** Kör en strömmande RAG-fråga och samlar ihop svar, källor och följdfrågor. */
export function useRagStream() {
  const [result, setResult] = useState<RagResult>(empty);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async (question: string, history?: ConversationMessage[]): Promise<RagResult> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const acc: RagResult = { content: "", sources: [], followUps: [], tools: [] };
    setResult(acc);
    setError(null);
    setStatus("Ansluter…");
    setRunning(true);
    try {
      await ragApi.query(
        { question, conversationHistory: history?.length ? history : null },
        (ev) => {
          switch (ev.type) {
            case "status":
              setStatus(ev.content ?? "");
              return;
            case "content":
              acc.content += ev.content ?? "";
              setStatus("");
              break;
            case "analysis":
              if (ev.analysisContent) acc.content += `\n\n${ev.analysisTitle ? `### ${ev.analysisTitle}\n\n` : ""}${ev.analysisContent}`;
              break;
            case "sources":
              acc.sources = ev.sources ?? [];
              break;
            case "tool":
              if (ev.toolEntry) acc.tools = [...acc.tools, ev.toolEntry];
              break;
            case "done":
              acc.followUps = ev.followUpSuggestions ?? acc.followUps;
              break;
            case "error":
              throw new Error(ev.error || "AI-tjänsten svarade med ett fel.");
          }
          setResult({ ...acc });
        },
        controller.signal,
      );
      return acc;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return acc;
      setError(e);
      throw e;
    } finally {
      if (abortRef.current === controller) {
        setRunning(false);
        setStatus("");
      }
    }
  }, []);

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setResult(empty);
    setError(null);
  }, []);

  return { run, stop, reset, result, status, running, error };
}
