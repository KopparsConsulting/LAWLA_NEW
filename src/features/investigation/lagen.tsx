/**
 * Verifiering och komplettering via lagen.nu för hänvisningar som saknas i underlaget.
 *
 * - `useLagenVerify` slår upp alla saknade hänvisningar i ett anrop (Workern cachar per hänvisning).
 * - `LagenCheck` visar resultatet för en hänvisning: textstället från lagen.nu och knappen
 *   "Lägg till i underlaget", som sparar textstället som rättskälla i utredningen (backend).
 *   Då blir hänvisningen spårbar och följer med i nästa analys.
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { BookPlus, Check, Columns3, Search, CircleAlert, CircleCheck, CircleHelp, ExternalLink, Loader2 } from "lucide-react";
import { lagenApi, projectsApi } from "@/api/client";
import { Button, Card, Input, Label, Spinner, cx } from "@/components/ui";
import { useToast } from "@/components/toast";
import {
  LAGEN_VERIFY_MAX,
  lagenEvidenceLabel,
  lagenPlainText,
  type LagenResolution,
  type LagenStatus,
} from "../../../shared/lagen";
import { fragmentOf, stripFragment } from "../../../shared/sourceDoc";
import { workspaceUrl } from "../workspace/link";

const STALE = 60 * 60_000;
const resolveKey = (q: string) => ["lagen-resolve", q] as const;

/** Slår upp flera hänvisningar på lagen.nu. Resultatet läggs även i cachen per hänvisning. */
export function useLagenVerify(texts: string[], enabled = true) {
  const qc = useQueryClient();
  const unique = [...new Set(texts)].sort();
  return useQuery({
    queryKey: ["lagen-verify", unique],
    enabled: enabled && unique.length > 0,
    staleTime: STALE,
    retry: 1,
    queryFn: async () => {
      const out = new Map<string, LagenResolution>();
      for (let i = 0; i < unique.length; i += LAGEN_VERIFY_MAX) {
        const { results } = await lagenApi.verify(unique.slice(i, i + LAGEN_VERIFY_MAX));
        for (const r of results) {
          out.set(r.query, r);
          if (r.status !== "error") qc.setQueryData(resolveKey(r.query), r);
        }
      }
      return out;
    },
  });
}

export function useLagenResolve(query: string | null) {
  return useQuery({
    queryKey: resolveKey(query ?? ""),
    queryFn: () => lagenApi.resolve(query!),
    enabled: !!query,
    staleTime: STALE,
    retry: 1,
  });
}

/* ─── Status ──────────────────────────────────────────────────────────── */

export const LAGEN_STATUS_TEXT: Record<LagenStatus, string> = {
  found: "Finns på lagen.nu",
  invalid: "Finns inte enligt lagen.nu",
  unknown: "Kunde inte tolkas av lagen.nu",
  error: "lagen.nu svarar inte",
};

export function LagenStatusIcon({ status, loading, className }: { status?: LagenStatus; loading?: boolean; className?: string }) {
  const c = cx("shrink-0", className ?? "size-3.5");
  if (loading) return <Loader2 className={cx(c, "animate-spin text-muted")} aria-label="Kontrollerar på lagen.nu" />;
  if (status === "found") return <CircleCheck className={cx(c, "text-ok")} aria-label={LAGEN_STATUS_TEXT.found} />;
  if (status === "invalid") return <CircleAlert className={cx(c, "text-danger")} aria-label={LAGEN_STATUS_TEXT.invalid} />;
  if (status) return <CircleHelp className={cx(c, "text-muted")} aria-label={LAGEN_STATUS_TEXT[status]} />;
  return null;
}

/** Sammanfattning av verifieringen, t.ex. "2 finns på lagen.nu · 1 finns inte". */
export function lagenSummary(results: Map<string, LagenResolution> | undefined, texts: string[]): string | null {
  if (!results) return null;
  const count = (s: LagenStatus) => texts.filter((t) => results.get(t)?.status === s).length;
  const parts: string[] = [];
  const found = count("found");
  const invalid = count("invalid");
  const other = texts.length - found - invalid;
  if (found) parts.push(`${found} finns på lagen.nu`);
  if (invalid) parts.push(`${invalid} finns inte enligt lagen.nu`);
  if (other) parts.push(`${other} gick inte att kontrollera`);
  return parts.join(" · ") || null;
}

/* ─── Lägg till från lagen.nu ─────────────────────────────────────────── */

interface LagenSource {
  uri: string;
  identifier: string | null;
  title: string | null;
}

function useAddFromLagen(projectId: number, citation: string) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (src: LagenSource) => {
      const text = await lagenApi.text(src.uri);
      const content = lagenPlainText(text.markdown);
      const date = new Date().toISOString().slice(0, 10);
      return projectsApi.addEvidence(projectId, {
        documentId: null,
        chunkId: null,
        content: content || null,
        displayLabel: lagenEvidenceLabel(citation, { identifier: src.identifier ?? text.identifier, title: src.title ?? text.title }),
        annotation: `Hämtad från lagen.nu ${date}: ${src.uri}${text.truncated ? " (utdrag)" : ""}. Kontrollera mot officiell källa.`,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["evidence", projectId] });
      void qc.invalidateQueries({ queryKey: ["project", projectId] });
      toast(`${citation} är tillagd i underlaget från lagen.nu.`);
    },
    onError: (e) => toast(e.message, "error"),
  });
}

/* ─── Panel för en saknad hänvisning ──────────────────────────────────── */

export function LagenCheck({ query, projectId }: { query: string; projectId: number }) {
  const resolution = useLagenResolve(query);
  const r = resolution.data;

  return (
    <section className="space-y-3 rounded-md border border-line p-3" aria-label="Kontroll mot lagen.nu">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <LagenStatusIcon status={r?.status} loading={resolution.isLoading} /> Kontroll mot lagen.nu
      </p>
      {resolution.isLoading && <p className="text-xs text-muted">Söker hänvisningen på lagen.nu…</p>}
      {resolution.error && <p className="text-xs text-muted">lagen.nu kunde inte nås just nu. Försök igen senare.</p>}
      {r?.status === "found" && <FoundSource r={r} query={query} projectId={projectId} />}
      {r?.status === "invalid" && (
        <p className="rounded-md bg-danger/5 p-2.5 text-xs text-danger">
          lagen.nu känner igen formen på hänvisningen men källan <strong>finns inte</strong> (t.ex. en paragraf som saknas i lagen eller ett rättsfall
          som inte är publicerat). Sannolikt en felaktig hänvisning från AI:n – rätta eller stryk den.
        </p>
      )}
      {(r?.status === "unknown" || r?.status === "error") && (
        <>
          <p className="text-xs text-muted">
            {r.status === "unknown"
              ? "lagen.nu kunde inte tolka hänvisningen exakt (t.ex. om lagens namn saknas). Närliggande träffar:"
              : "lagen.nu svarade inte på uppslaget. Sökträffar:"}
          </p>
          <LagenSearchList query={query} projectId={projectId} />
        </>
      )}
    </section>
  );
}

function FoundSource({ r, query, projectId }: { r: LagenResolution; query: string; projectId: number }) {
  const text = useQuery({ queryKey: ["lagen-text", r.uri], queryFn: () => lagenApi.text(r.uri!), enabled: !!r.uri, staleTime: STALE });
  const add = useAddFromLagen(projectId, query);
  const plain = text.data ? lagenPlainText(text.data.markdown) : null;
  // En hel lag utan utpekad paragraf läggs inte till – lagens början säger inget som underlag.
  // Den öppnas i stället i arbetsytan, där juristen väljer paragraf.
  const wholeLaw = !r.pinLabel && r.source === "sfs";
  const workspace = r.uri ? workspaceUrl(projectId, { source: { kind: "lagen", uri: stripFragment(r.uri) }, anchor: fragmentOf(r.uri) }) : null;

  if (wholeLaw) {
    return (
      <div className="space-y-3 text-sm">
        <div>
          <p className="font-medium text-ink">{r.title}</p>
          <p className="text-xs text-muted">{[r.kindLabel, r.identifier].filter(Boolean).join(" · ")}</p>
        </div>
        <p className="text-xs leading-5 text-muted">
          Hänvisningen pekar på hela lagen, inte en paragraf. Öppna lagen i arbetsytan och markera de paragrafer som är relevanta – eller skriv hänvisningen med paragraf,
          t.ex. <em>4 kap. 1 § {r.title?.split(" (")[0]?.toLowerCase()}</em>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {workspace && (
            <Link to={workspace} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-accent-ink hover:opacity-90">
              <Columns3 className="size-3.5" /> Öppna i arbetsytan
            </Link>
          )}
          {r.url && (
            <a href={r.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              Öppna på lagen.nu <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="font-medium text-ink">
          {[r.pinLabel, r.title].filter(Boolean).join(" ")}
        </p>
        <p className="text-xs text-muted">{[r.kindLabel, r.identifier].filter(Boolean).join(" · ")}</p>
      </div>
      {text.isLoading && <Spinner label="Hämtar textstället från lagen.nu…" />}
      {plain ? (
        <div className="max-h-80 overflow-y-auto whitespace-pre-line rounded-md bg-sunken/60 p-3 text-[14px] leading-6">
          {plain}
          {text.data?.truncated && <span className="mt-2 block text-xs text-muted">Texten är förkortad – se hela dokumentet på lagen.nu.</span>}
        </div>
      ) : (
        r.excerpt && !text.isLoading && <p className="rounded-md bg-sunken/60 p-3 text-[14px] leading-6">{r.excerpt}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {add.isSuccess ? (
          <span className="inline-flex items-center gap-1 text-sm text-ok">
            <Check className="size-4" /> Tillagd i underlaget – kör analysen igen så blir hänvisningen spårbar.
          </span>
        ) : (
          <Button size="sm" icon={<BookPlus className="size-3.5" />} loading={add.isPending} onClick={() => add.mutate({ uri: r.uri!, identifier: r.identifier, title: r.title })}>
            Lägg till i underlaget
          </Button>
        )}
        {workspace && (
          <Link to={workspace} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            <Columns3 className="size-3" /> Öppna i arbetsytan
          </Link>
        )}
        {r.url && (
          <a href={r.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
            Öppna på lagen.nu <ExternalLink className="size-3" />
          </a>
        )}
        {text.data?.sourceUrl && (
          <a href={text.data.sourceUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-xs text-muted hover:underline">
            Officiell källa <ExternalLink className="size-3" />
          </a>
        )}
      </div>
      <p className="text-xs text-muted">Hänvisningen finns, men har inte kontrollerats mot ärendet. Läs textstället innan du lägger till det.</p>
    </div>
  );
}

function LagenSearchList({ query, projectId }: { query: string; projectId: number }) {
  const search = useQuery({ queryKey: ["lagen-search", query], queryFn: () => lagenApi.search(query, 5), staleTime: STALE, retry: 1 });
  const add = useAddFromLagen(projectId, query);
  const [addedUri, setAddedUri] = useState<string | null>(null);

  if (search.isLoading) return <Spinner label="Söker på lagen.nu…" />;
  if (search.error) return <p className="text-xs text-muted">Sökningen på lagen.nu misslyckades.</p>;
  const hits = search.data?.results ?? [];
  if (hits.length === 0) return <p className="text-xs text-muted">Inga träffar på lagen.nu.</p>;

  return (
    <ul className="space-y-2">
      {hits.map((h) => (
        <li key={h.uri} className="rounded-md border border-line p-2.5 text-sm">
          <a href={h.url} target="_blank" rel="noreferrer noopener" className="font-medium text-ink hover:text-accent hover:underline">
            {h.title || h.identifier || h.uri}
          </a>
          <p className="text-xs text-muted">{[h.kindLabel, h.identifier].filter(Boolean).join(" · ")}</p>
          {h.excerpt && <p className="mt-1 line-clamp-3 text-xs leading-5">{h.excerpt}</p>}
          <div className="mt-2">
            {addedUri === h.uri ? (
              <span className="inline-flex items-center gap-1 text-xs text-ok">
                <Check className="size-3.5" /> Tillagd i underlaget
              </span>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                icon={<BookPlus className="size-3.5" />}
                loading={add.isPending && add.variables?.uri === h.uri}
                disabled={add.isPending}
                onClick={() => add.mutate({ uri: h.uri, identifier: h.identifier, title: h.title }, { onSuccess: () => setAddedUri(h.uri) })}
              >
                Lägg till som {query}
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ─── Fristående sökning i rättskällesteget ───────────────────────────── */

/** "Hämta från lagen.nu": slå upp en hänvisning (eller sök fritt) och lägg till textstället i underlaget. */
export function LagenFinder({ projectId, initialQuery = "" }: { projectId: number; initialQuery?: string }) {
  const [draft, setDraft] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);

  function submit(e: FormEvent) {
    e.preventDefault();
    setQuery(draft.replace(/\s+/g, " ").trim().slice(0, 300));
  }

  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Hämta från lagen.nu</h3>
      <Card className="space-y-3 p-4">
        <p className="text-xs text-muted">
          För källor som saknas i Lawlas korpus. Skriv en hänvisning – t.ex. <em>36 § AvtL</em>, <em>12 kap. 3 § ÄktB</em>, <em>NJA 2015 s. 899</em> eller{" "}
          <em>prop. 2016/17:180</em> – så kontrolleras den mot lagen.nu och textstället kan läggas till i underlaget.
        </p>
        <form onSubmit={submit} className="flex gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="lagen-q">Hänvisning</Label>
            <Input id="lagen-q" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="T.ex. 36 § AvtL" maxLength={300} />
          </div>
          <Button type="submit" variant="secondary" className="self-end" icon={<Search className="size-4" />} disabled={!draft.trim()}>
            Kontrollera
          </Button>
        </form>
        {query && <LagenCheck key={query} query={query} projectId={projectId} />}
      </Card>
    </section>
  );
}
