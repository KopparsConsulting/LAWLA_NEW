import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowUp, RotateCcw, Square } from "lucide-react";
import type { ConversationMessage, RagSourceDto } from "@/api/types";
import { Button, ErrorNote, Markdown, PageHeader, Textarea } from "@/components/ui";
import { useRagStream } from "@/lib/useRagStream";

interface Turn {
  question: string;
  answer: string;
  sources: RagSourceDto[];
  followUps: string[];
}

const EXAMPLES = [
  "Under vilka förutsättningar kan ett äktenskapsförord jämkas?",
  "Vad krävs för att ett avtal ska kunna jämkas enligt 36 § avtalslagen?",
  "Hur bedöms culpa in contrahendo i svensk rätt?",
];

export default function AskPage() {
  const rag = useRagStream();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, pending, rag.result.content]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || rag.running) return;
    setInput("");
    setPending(q);
    const history: ConversationMessage[] = turns.flatMap((t) => [
      { role: "user" as const, content: t.question },
      { role: "assistant" as const, content: t.answer },
    ]);
    try {
      const res = await rag.run(q, history);
      setTurns((t) => [...t, { question: q, answer: res.content, sources: res.sources, followUps: res.followUps }]);
    } catch {
      /* visas via rag.error */
    } finally {
      setPending(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      <PageHeader
        title="Fråga Lawla"
        subtitle="Ställ en juridisk fråga och få ett svar med hänvisningar till rättskällorna i plattformen."
        actions={
          turns.length > 0 && (
            <Button variant="ghost" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => { rag.reset(); setTurns([]); }}>
              Ny konversation
            </Button>
          )
        }
      />

      <div className="flex-1 space-y-8">
        {turns.length === 0 && !pending && (
          <div className="grid gap-2 sm:grid-cols-3">
            {EXAMPLES.map((ex) => (
              <button key={ex} onClick={() => void ask(ex)} className="rounded-lg border border-line bg-surface p-4 text-left text-sm hover:border-accent/50">
                {ex}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <TurnView key={i} turn={t} onFollowUp={(q) => void ask(q)} isLast={i === turns.length - 1 && !pending} />
        ))}
        {pending && (
          <div>
            <Question text={pending} />
            <div className="mt-4">
              {rag.result.content ? <Markdown>{rag.result.content}</Markdown> : <p className="animate-pulse text-sm text-muted">{rag.status || "Söker i rättskällorna…"}</p>}
            </div>
          </div>
        )}
        {rag.error != null && !pending && <ErrorNote error={rag.error} />}
        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-0 mt-8 bg-paper pb-2 pt-2">
        <div className="flex items-end gap-2 rounded-lg border border-line bg-surface p-2 focus-within:border-accent">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(input);
              }
            }}
            rows={2}
            placeholder="Skriv din fråga…"
            className="resize-none border-0 bg-transparent focus:border-0 focus-visible:outline-none"
            aria-label="Fråga"
          />
          {rag.running ? (
            <Button type="button" variant="secondary" onClick={rag.stop} aria-label="Avbryt">
              <Square className="size-4" />
            </Button>
          ) : (
            <Button type="submit" disabled={!input.trim()} aria-label="Skicka">
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-center text-xs text-muted">Svaren är AI-genererade och ska kontrolleras mot källorna.</p>
      </form>
    </div>
  );
}

function Question({ text }: { text: string }) {
  return <p className="font-serif text-xl leading-snug">{text}</p>;
}

function TurnView({ turn, onFollowUp, isLast }: { turn: Turn; onFollowUp: (q: string) => void; isLast: boolean }) {
  return (
    <div>
      <Question text={turn.question} />
      <div className="mt-4">
        <Markdown>{turn.answer || "_Inget svar._"}</Markdown>
      </div>
      {turn.sources.length > 0 && (
        <details className="mt-4 rounded-lg border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Källor ({turn.sources.length})</summary>
          <ul className="space-y-3 border-t border-line p-4">
            {turn.sources.map((s) => (
              <li key={s.documentId}>
                <Link to={`/dokument/${s.documentId}${s.passages[0] ? `#chunk-${s.passages[0].chunkId}` : ""}`} className="text-sm font-medium text-accent hover:underline">
                  {s.title}
                </Link>
                <ul className="mt-1 space-y-1">
                  {s.passages.slice(0, 3).map((p) => (
                    <li key={p.chunkId} className="text-xs text-muted">
                      <Link to={`/dokument/${s.documentId}#chunk-${p.chunkId}`} className="hover:text-ink">
                        {p.displayLabel}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
      {isLast && turn.followUps.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {turn.followUps.map((f) => (
            <button key={f} onClick={() => onFollowUp(f)} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-accent hover:text-accent">
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
