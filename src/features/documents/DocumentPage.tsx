import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Plus } from "lucide-react";
import { documentsApi, projectsApi } from "@/api/client";
import type { ChunkDetailDto } from "@/api/types";
import { Badge, Card, ErrorNote, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";

export default function DocumentPage() {
  const id = Number(useParams().id);
  const { hash } = useLocation();
  const doc = useQuery({ queryKey: ["document", id], queryFn: () => documentsApi.get(id) });
  const chunks = useQuery({ queryKey: ["chunks", id], queryFn: () => documentsApi.chunks(id) });
  const outgoing = useQuery({ queryKey: ["refsOut", id], queryFn: () => documentsApi.outgoing(id) });
  const incoming = useQuery({ queryKey: ["refsIn", id], queryFn: () => documentsApi.incoming(id) });

  useEffect(() => {
    if (!hash || !chunks.data) return;
    const el = document.getElementById(hash.slice(1));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash, chunks.data]);

  if (doc.isLoading) return <Spinner />;
  if (doc.error || !doc.data) return <ErrorNote error={doc.error} onRetry={() => doc.refetch()} />;
  const d = doc.data;
  const sorted = [...(chunks.data ?? [])].sort((a, b) => a.chunkIndex - b.chunkIndex);
  const resolvedOut = (outgoing.data ?? []).filter((r) => r.isResolved && r.targetDocumentId);

  return (
    <div>
      <Link to="/dokument" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" /> Rättskällor
      </Link>
      <div className="mb-8">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {d.documentType && <Badge tone="accent">{d.documentType}</Badge>}
          {d.canonicalId && <span className="text-xs text-muted">{d.canonicalId}</span>}
        </div>
        <h1 className="font-serif text-3xl leading-tight">{d.title}</h1>
        {d.source && /^https?:\/\//.test(d.source) && (
          <a href={d.source} target="_blank" rel="noreferrer noopener" className="mt-2 inline-flex items-center gap-1 text-sm text-accent hover:underline">
            Originalkälla <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_260px]">
        <article className="min-w-0 space-y-6">
          {chunks.isLoading && <Spinner label="Hämtar text…" />}
          {chunks.error && <ErrorNote error={chunks.error} onRetry={() => chunks.refetch()} />}
          {sorted.map((c) => (
            <ChunkBlock key={c.id} chunk={c} highlighted={hash === `#chunk-${c.id}`} />
          ))}
        </article>

        <aside className="space-y-6 text-sm lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
          {sorted.length > 1 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Innehåll</h2>
              <ul className="space-y-0.5">
                {sorted.map((c) => (
                  <li key={c.id}>
                    <a href={`#chunk-${c.id}`} className="block truncate rounded px-2 py-1 text-muted hover:bg-sunken hover:text-ink">
                      {c.displayLabel || `Avsnitt ${c.chunkIndex + 1}`}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {resolvedOut.length > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Hänvisar till</h2>
              <ul className="space-y-1">
                {resolvedOut.slice(0, 30).map((r) => (
                  <li key={r.id}>
                    <Link to={`/dokument/${r.targetDocumentId}`} className="text-accent hover:underline">
                      {r.targetDocumentTitle || r.canonicalForm}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(incoming.data?.length ?? 0) > 0 && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Citeras av</h2>
              <ul className="space-y-1">
                {incoming.data!.slice(0, 30).map((r) => (
                  <li key={r.id}>
                    <Link to={`/dokument/${r.sourceDocumentId}`} className="text-accent hover:underline">
                      {r.sourceDocumentTitle}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function ChunkBlock({ chunk, highlighted }: { chunk: ChunkDetailDto; highlighted: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <section id={`chunk-${chunk.id}`} className={`scroll-mt-6 rounded-lg ${highlighted ? "bg-accent-soft/50 p-4 ring-1 ring-accent/30" : ""}`}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        {chunk.displayLabel && <h2 className="font-serif text-lg">{chunk.displayLabel}</h2>}
        <button onClick={() => setAdding((v) => !v)} className="ml-auto flex items-center gap-1 text-xs text-muted hover:text-accent">
          <Plus className="size-3.5" /> Till utredning
        </button>
      </div>
      {adding && <AddToInvestigation chunk={chunk} onDone={() => setAdding(false)} />}
      <p className="whitespace-pre-line text-[15px] leading-7">{chunk.content}</p>
    </section>
  );
}

function AddToInvestigation({ chunk, onDone }: { chunk: ChunkDetailDto; onDone: () => void }) {
  const toast = useToast();
  const projects = useQuery({ queryKey: ["projects"], queryFn: projectsApi.list });
  const add = useMutation({
    mutationFn: (projectId: number) =>
      projectsApi.addEvidence(projectId, {
        documentId: chunk.documentId,
        chunkId: chunk.id,
        displayLabel: chunk.displayLabel ? `${chunk.documentTitle} – ${chunk.displayLabel}` : chunk.documentTitle,
        content: chunk.content,
      }),
    onSuccess: () => {
      toast("Avsnittet är tillagt i utredningen.");
      onDone();
    },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <Card className="mb-3 p-3">
      <p className="mb-2 text-xs text-muted">Lägg till avsnittet som rättskälla i:</p>
      {projects.isLoading && <Spinner />}
      <div className="flex flex-wrap gap-1.5">
        {projects.data?.map((p) => (
          <button
            key={p.id}
            disabled={add.isPending}
            onClick={() => add.mutate(p.id)}
            className="rounded-full border border-line px-3 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {p.title || `Utredning ${p.id}`}
          </button>
        ))}
        {projects.data?.length === 0 && <p className="text-xs text-muted">Du har inga utredningar ännu.</p>}
      </div>
    </Card>
  );
}
