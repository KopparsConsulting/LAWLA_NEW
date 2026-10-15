import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { documentsApi } from "@/api/client";
import { Badge, Button, Card, EmptyState, ErrorNote, Input, PageHeader, Spinner } from "@/components/ui";

const PAGE_SIZE = 20;

export default function DocumentsPage() {
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const documentType = params.get("typ") ?? "";
  const searchContent = params.get("text") === "1";
  const page = Math.max(1, Number(params.get("sida")) || 1);
  const [draft, setDraft] = useState(search);

  useEffect(() => setDraft(search), [search]);

  function update(next: Record<string, string | null>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!("sida" in next)) p.delete("sida");
    setParams(p, { replace: true });
  }

  const stats = useQuery({ queryKey: ["docStats"], queryFn: documentsApi.stats, staleTime: 10 * 60_000 });
  const docs = useQuery({
    queryKey: ["documents", search, documentType, searchContent, page],
    queryFn: () => documentsApi.list({ search, documentType, searchContent, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const types = Object.entries(stats.data?.typeCounts ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader title="Rättskällor" subtitle={stats.data ? `${stats.data.totalCount.toLocaleString("sv-SE")} dokument i plattformen` : undefined} />

      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: draft.trim() || null });
        }}
      >
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Sök på titel, t.ex. äktenskapsbalk eller NJA 2018" className="pl-9" aria-label="Sök dokument" />
        </div>
        <Button type="submit">Sök</Button>
      </form>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <button
          onClick={() => update({ typ: null })}
          className={`rounded-full px-3 py-1 text-xs ${!documentType ? "bg-accent text-accent-ink" : "bg-sunken text-muted hover:text-ink"}`}
        >
          Alla typer
        </button>
        {types.map(([t, n]) => (
          <button
            key={t}
            onClick={() => update({ typ: t })}
            className={`rounded-full px-3 py-1 text-xs ${documentType === t ? "bg-accent text-accent-ink" : "bg-sunken text-muted hover:text-ink"}`}
          >
            {t} <span className="opacity-60">{n}</span>
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={searchContent} onChange={(e) => update({ text: e.target.checked ? "1" : null })} />
          Sök även i texten
        </label>
      </div>

      {docs.isLoading && <Spinner />}
      {docs.error && <ErrorNote error={docs.error} onRetry={() => docs.refetch()} />}
      {docs.data?.length === 0 && <EmptyState title="Inga dokument matchar sökningen" />}

      <div className={`grid gap-2 ${docs.isPlaceholderData ? "opacity-60" : ""}`}>
        {docs.data?.map((d) => (
          <Link key={d.id} to={`/dokument/${d.id}`}>
            <Card className="flex items-center gap-4 px-4 py-3 hover:border-accent/50">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{d.title || "Utan titel"}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {[d.canonicalId, `${d.chunkCount} avsnitt`, d.incomingReferenceCount ? `citeras ${d.incomingReferenceCount} ggr` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              {d.documentType && <Badge>{d.documentType}</Badge>}
            </Card>
          </Link>
        ))}
      </div>

      {docs.data && (page > 1 || docs.data.length === PAGE_SIZE) && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => update({ sida: String(page - 1) })} icon={<ChevronLeft className="size-4" />}>
            Föregående
          </Button>
          <span className="text-sm text-muted">Sida {page}</span>
          <Button variant="secondary" size="sm" disabled={docs.data.length < PAGE_SIZE} onClick={() => update({ sida: String(page + 1) })}>
            Nästa <ChevronRight className="size-4" />
          </Button>
        </div>
      )}
    </>
  );
}
