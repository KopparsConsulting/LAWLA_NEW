import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileSearch, Link2, Plus, Search } from "lucide-react";
import { lagenApi, riksdagenApi } from "@/api/client";
import { Button, Input } from "@/components/ui";
import { isLagenUri } from "../../../shared/lagen";
import { FORARBETE_TYPER, parseBeteckning, riksdagenIdFromUrl, type ForarbeteTyp } from "../../../shared/riksdagen";
import { fragmentOf, stripFragment, type SourceRef } from "../../../shared/sourceDoc";

export type AddChoice = { kind: "search" } | { kind: "forarbete"; typ: ForarbeteTyp } | { kind: "url" };

/** "+"-menyn i flikraden: sök rättskälla, lägg till förarbete eller hämta från URL. */
export function AddMenu({ onChoose, compact }: { onChoose: (c: AddChoice) => void; compact: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const pick = (c: AddChoice) => {
    setOpen(false);
    onChoose(c);
  };
  return (
    <div ref={ref} className="relative mb-1 shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface hover:text-ink"
        title="Öppna rättskälla eller lägg till förarbete"
      >
        <Plus className="size-3.5" /> {compact ? null : "Öppna rättskälla"}
      </button>
      {open && (
        <div role="menu" className="fixed z-50 mt-1 w-56 rounded-lg border border-line bg-surface py-1 text-sm shadow-xl" style={menuPosition(ref.current)}>
          <MenuItem icon={<Search className="size-4" />} onClick={() => pick({ kind: "search" })}>
            Sök rättskälla …
          </MenuItem>
          <p className="mt-1 border-t border-line px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Lägg till förarbete</p>
          {FORARBETE_TYPER.map((t) => (
            <MenuItem key={t.typ} icon={<FileSearch className="size-4" />} onClick={() => pick({ kind: "forarbete", typ: t.typ })}>
              {t.label}
            </MenuItem>
          ))}
          <MenuItem icon={<Link2 className="size-4" />} onClick={() => pick({ kind: "url" })}>
            Övrigt – hämta från URL
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function menuPosition(el: HTMLElement | null): React.CSSProperties {
  const r = el?.getBoundingClientRect();
  if (!r) return {};
  return { top: r.bottom + 2, left: Math.min(r.left, window.innerWidth - 232) };
}

function MenuItem({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button role="menuitem" onClick={onClick} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-sunken">
      <span className="text-muted">{icon}</span> {children}
    </button>
  );
}

/**
 * Lägg till ett förarbete efter beteckning (Proposition, SOU, Ds via lagen.nu med riksdagen.se som
 * reserv; betänkanden från riksdagen.se) eller hämta ett dokument från en adress.
 */
export function AddForarbeteDialog({ choice, onClose, onOpen }: { choice: Exclude<AddChoice, { kind: "search" }>; onClose: () => void; onOpen: (ref: SourceRef, anchor?: string | null) => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typ = choice.kind === "forarbete" ? FORARBETE_TYPER.find((t) => t.typ === choice.typ)! : null;

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (choice.kind === "url") {
        const url = value.trim();
        if (isLagenUri(url)) return onOpen({ kind: "lagen", uri: stripFragment(url) }, fragmentOf(url));
        const id = riksdagenIdFromUrl(url);
        if (id) return onOpen({ kind: "riksdagen", dokId: id });
        throw new Error("Ange en adress till ett dokument på riksdagen.se eller lagen.nu.");
      }
      const bet = parseBeteckning(value);
      if (!bet || !typ) throw new Error(`Ange beteckningen som ${typ?.example}.`);
      const beteckning = `${bet.rm}:${bet.bet}`;
      // Propositioner, SOU och Ds finns strukturerade på lagen.nu – bättre rubriker och kommentarer.
      if (typ.typ !== "bet") {
        const r = await qc
          .fetchQuery({ queryKey: ["lagen-resolve", `${typ.prefix} ${beteckning}`], queryFn: () => lagenApi.resolve(`${typ.prefix} ${beteckning}`), staleTime: 60 * 60_000 })
          .catch(() => null);
        if (r?.status === "found" && r.uri) return onOpen({ kind: "lagen", uri: stripFragment(r.uri) });
      }
      const doc = await riksdagenApi.find(typ.typ, beteckning);
      onOpen({ kind: "riksdagen", dokId: doc.dokId });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title = choice.kind === "url" ? "Hämta från URL" : `Lägg till ${typ!.label.toLowerCase() === "sou" || typ!.typ === "ds" ? typ!.label : typ!.label.toLowerCase()}`;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-ink/30 p-4 pt-[14vh]" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-lg border border-line bg-surface p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="font-medium">{title}</p>
        <div>
          <label htmlFor="forarbete-input" className="mb-1 block text-xs text-muted">
            {choice.kind === "url" ? "Adress till dokumentet" : `Beteckning, t.ex. ${typ!.example}`}
          </label>
          <Input
            id="forarbete-input"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={choice.kind === "url" ? "https://www.riksdagen.se/sv/dokument-och-lagar/dokument/…" : typ!.example}
          />
          <p className="mt-1.5 text-xs text-muted">
            {choice.kind === "url"
              ? "Dokument från riksdagen.se (propositioner, betänkanden, SOU, Ds m.m.) och lagen.nu."
              : typ!.typ === "bet"
                ? "Hämtas från riksdagen.se."
                : "Hämtas från lagen.nu, annars från riksdagen.se."}
          </p>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Avbryt
          </Button>
          <Button type="submit" loading={busy} disabled={!value.trim()}>
            Öppna
          </Button>
        </div>
      </form>
    </div>
  );
}
