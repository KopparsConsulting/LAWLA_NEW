import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink, Link2, Link2Off, X } from "lucide-react";
import clsx from "clsx";
import { shareApi } from "@/api/client";
import type { ExpandedEvidenceDto } from "@/api/types";
import { Badge, Button, ErrorNote, Input, Label, Spinner } from "@/components/ui";
import { useToast } from "@/components/toast";
import { formatDate, formatDateTime } from "@/lib/format";
import { shareStatus, shareUrl, type SharedEvidence, type ShareSummary } from "../../../shared/sharing";

const EXPIRY_OPTIONS: { days: number; label: string }[] = [
  { days: 7, label: "7 dagar" },
  { days: 30, label: "30 dagar" },
  { days: 90, label: "90 dagar" },
  { days: 0, label: "Tills vidare" },
];

export function toSharedEvidence(e: ExpandedEvidenceDto): SharedEvidence {
  return {
    id: e.id,
    displayLabel: e.displayLabel,
    documentTitle: e.documentTitle,
    content: e.content,
    annotation: e.annotation,
    chapter: e.chapter,
    paragraph: e.paragraph,
  };
}

/**
 * Dela rapporten via unik länk. Rapporten fryses som den ser ut nu (valda avsnitt, vald analys);
 * mottagaren behöver ingen inloggning. Länkar kan tidsbegränsas och återkallas.
 */
export function SharePanel({
  projectId,
  title,
  markdown,
  evidence,
  onClose,
}: {
  projectId: number;
  title: string;
  markdown: string;
  evidence: ExpandedEvidenceDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["shares", projectId];
  const shares = useQuery({ queryKey: key, queryFn: () => shareApi.list(projectId) });
  const [label, setLabel] = useState("");
  const [days, setDays] = useState(30);
  const [created, setCreated] = useState<ShareSummary | null>(null);

  const create = useMutation({
    mutationFn: () =>
      shareApi.create(projectId, { title, markdown, evidence: evidence.map(toSharedEvidence), label: label.trim() || null, expiresInDays: days }),
    onSuccess: ({ share }) => {
      setCreated(share);
      setLabel("");
      void qc.invalidateQueries({ queryKey: key });
    },
  });
  const revoke = useMutation({
    mutationFn: (token: string) => shareApi.revoke(projectId, token),
    onSuccess: (_, token) => {
      if (created?.token === token) setCreated(null);
      void qc.invalidateQueries({ queryKey: key });
      toast("Länken är återkallad.");
    },
    onError: (e) => toast(e.message, "error"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  const list = shares.data ?? [];
  const active = list.filter((s) => shareStatus(s) === "active");
  const inactive = list.filter((s) => shareStatus(s) !== "active");

  return (
    <div className="fixed inset-0 z-40 flex justify-end print:hidden" role="dialog" aria-modal="true" aria-label="Dela rapporten">
      <button className="flex-1 bg-ink/30" onClick={onClose} aria-label="Stäng" />
      <aside className="flex h-full w-full max-w-lg flex-col border-l border-line bg-surface shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="flex items-center gap-2 font-serif text-lg">
              <Link2 className="size-4 text-accent" aria-hidden /> Dela rapporten
            </h2>
            <p className="mt-1 text-xs text-muted">
              Den som har länken kan läsa rapporten utan att logga in. Rapporten fryses som den ser ut nu – ändringar i utredningen syns inte i
              länken.
            </p>
          </div>
          <button onClick={onClose} aria-label="Stäng" className="rounded p-1 text-muted hover:bg-sunken hover:text-ink">
            <X className="size-5" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {created ? (
            <CreatedLink share={created} onDone={() => setCreated(null)} />
          ) : (
            <form onSubmit={submit} className="space-y-3 rounded-lg border border-line bg-accent-soft/30 p-4">
              <div>
                <Label htmlFor="share-label">Etikett (valfri)</Label>
                <Input id="share-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="T.ex. Till klienten, Kollegial granskning" maxLength={200} />
              </div>
              <div>
                <Label>Länken gäller i</Label>
                <div className="flex flex-wrap gap-1.5">
                  {EXPIRY_OPTIONS.map((o) => (
                    <button
                      key={o.days}
                      type="button"
                      onClick={() => setDays(o.days)}
                      className={clsx(
                        "rounded-full border px-3 py-1 text-sm",
                        days === o.days ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted hover:border-accent hover:text-accent",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              {create.error && <ErrorNote error={create.error} />}
              <Button type="submit" loading={create.isPending} icon={<Link2 className="size-4" />}>
                Skapa länk
              </Button>
            </form>
          )}

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Aktiva länkar</p>
            {shares.isLoading && <Spinner />}
            {shares.error && <ErrorNote error={shares.error} onRetry={() => shares.refetch()} />}
            {shares.data && active.length === 0 && <p className="text-sm text-muted">Inga aktiva länkar för den här utredningen.</p>}
            <ul className="space-y-2">
              {active.map((s) => (
                <ShareRow key={s.token} share={s} onRevoke={() => revoke.mutate(s.token)} revoking={revoke.isPending && revoke.variables === s.token} />
              ))}
            </ul>
          </section>

          {inactive.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Återkallade och utgångna</p>
              <ul className="space-y-1">
                {inactive.map((s) => (
                  <li key={s.token} className="flex items-center justify-between gap-2 text-xs text-muted">
                    <span className="truncate">
                      {s.label || s.title} · {formatDateTime(s.createdAt)}
                    </span>
                    <Badge>{shareStatus(s) === "revoked" ? "Återkallad" : "Utgången"}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

function CreatedLink({ share, onDone }: { share: ShareSummary; onDone: () => void }) {
  const url = shareUrl(window.location.origin, share.token);
  return (
    <div className="space-y-3 rounded-lg border border-ok/40 bg-ok/5 p-4">
      <p className="flex items-center gap-1.5 text-sm font-medium text-ok">
        <Check className="size-4" aria-hidden /> Länken är skapad
      </p>
      <CopyField url={url} />
      <p className="text-xs text-muted">
        {share.expiresAt ? `Gäller till ${formatDate(share.expiresAt)}.` : "Gäller tills du återkallar den."} Skicka länken till mottagaren via den kanal ni
        brukar använda.
      </p>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Skapa en till länk
      </Button>
    </div>
  );
}

function CopyField({ url }: { url: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast("Kunde inte kopiera – markera länken och kopiera manuellt.", "error");
    }
  }
  return (
    <div className="flex gap-2">
      <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Delningslänk" className="font-mono text-xs" />
      <Button type="button" variant="secondary" icon={copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />} onClick={() => void copy()}>
        {copied ? "Kopierad" : "Kopiera"}
      </Button>
    </div>
  );
}

function ShareRow({ share, onRevoke, revoking }: { share: ShareSummary; onRevoke: () => void; revoking: boolean }) {
  const url = shareUrl(window.location.origin, share.token);
  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{share.label || share.title}</p>
          <p className="text-xs text-muted">
            Skapad {formatDateTime(share.createdAt)}
            {share.createdBy ? ` av ${share.createdBy}` : ""} · {share.expiresAt ? `gäller till ${formatDate(share.expiresAt)}` : "tills vidare"} ·{" "}
            {share.views === 1 ? "1 visning" : `${share.views} visningar`}
          </p>
        </div>
        <Button size="sm" variant="danger" icon={<Link2Off className="size-3.5" />} loading={revoking} onClick={onRevoke}>
          Återkalla
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <CopyField url={url} />
        <a href={url} target="_blank" rel="noreferrer noopener" className="shrink-0 text-muted hover:text-accent" title="Öppna i ny flik" aria-label="Öppna i ny flik">
          <ExternalLink className="size-4" />
        </a>
      </div>
    </li>
  );
}
