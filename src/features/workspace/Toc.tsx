import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ChevronRight } from "lucide-react";
import type { TocEntry } from "../../../shared/sourceDoc";

/**
 * Innehållsförteckning för den öppna källan. Långa lagar visas med kapitel och rubriker
 * ihopfällda; avsnittet man läser fälls ut automatiskt och markeras.
 */
export function Toc({
  entries,
  active,
  marked,
  onJump,
}: {
  entries: TocEntry[];
  active: string | null;
  /** Ankare som har källor i underlaget. */
  marked: Set<string>;
  onJump: (anchor: string) => void;
}) {
  const [filter, setFilter] = useState("");
  // Index → ankare för förälder (närmaste föregående rubrik på lägre nivå).
  const parents = useMemo(() => {
    const stack: TocEntry[] = [];
    return entries.map((e) => {
      while (stack.length && stack[stack.length - 1]!.level >= e.level) stack.pop();
      const parentChain = stack.map((s) => s.anchor);
      if (!e.leaf) stack.push(e);
      return parentChain;
    });
  }, [entries]);
  const hasChildren = useMemo(() => {
    const set = new Set<string>();
    parents.forEach((chain) => chain.length && set.add(chain[chain.length - 1]!));
    return set;
  }, [parents]);

  const big = entries.length > 80;
  // Det användaren själv fällt ut/ihop; vägen till det aktiva avsnittet visas alltid utfälld.
  const [userOpen, setUserOpen] = useState<Set<string>>(() => new Set(big ? [] : entries.map((e) => e.anchor)));
  const [userClosed, setUserClosed] = useState<Set<string>>(() => new Set());
  const activeIndex = entries.findIndex((e) => e.anchor === active);
  const activeChain = useMemo(() => new Set(activeIndex >= 0 ? parents[activeIndex] : []), [activeIndex, parents]);
  const open = useMemo(() => {
    const s = new Set(userOpen);
    for (const a of activeChain) if (!userClosed.has(a)) s.add(a);
    return s;
  }, [userOpen, userClosed, activeChain]);
  const setOpen = (fn: (prev: Set<string>) => Set<string>) => {
    const next = fn(open);
    setUserOpen(next);
    setUserClosed((prev) => {
      const c = new Set(prev);
      for (const a of activeChain) if (next.has(a)) c.delete(a);
      else c.add(a);
      return c;
    });
  };

  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    // Håll det aktiva avsnittet synligt i listan (utan att rulla sidan).
    const root = list.current;
    const el = root?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!root || !el) return;
    const r = el.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) root.scrollTop += r.top - box.top - box.height / 3;
  }, [active, open]);

  const q = filter.trim().toLowerCase();
  const visible = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e, i }) => (q ? e.label.toLowerCase().includes(q) : parents[i]!.every((a) => open.has(a))));
  const minLevel = Math.min(...entries.map((e) => e.level));

  if (entries.length === 0) return <p className="px-3 py-2 text-xs text-muted">Källan saknar innehållsförteckning.</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {entries.length > 12 && (
        <div className="px-2 pb-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrera, t.ex. 4 kap."
            aria-label="Filtrera innehållsförteckningen"
            className="h-8 w-full rounded-md border border-line bg-surface px-2.5 text-xs placeholder:text-muted/70 focus:border-accent focus:outline-none"
          />
        </div>
      )}
      <ul ref={list} className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 text-[13px]">
        {visible.map(({ e }) => {
          const indent = q ? 0 : e.level - minLevel;
          const isOpen = open.has(e.anchor);
          const expandable = !e.leaf && hasChildren.has(e.anchor) && !q;
          return (
            <li key={e.anchor} className="flex items-start" style={{ paddingLeft: indent * 12 }}>
              {expandable ? (
                <button
                  onClick={() => setOpen((prev) => toggle(prev, e.anchor))}
                  aria-label={isOpen ? `Fäll ihop ${e.label}` : `Fäll ut ${e.label}`}
                  aria-expanded={isOpen}
                  className="mt-1 rounded p-0.5 text-muted hover:bg-sunken hover:text-ink"
                >
                  <ChevronRight className={clsx("size-3.5 transition-transform", isOpen && "rotate-90")} />
                </button>
              ) : (
                <span className="w-[18px] shrink-0" />
              )}
              <button
                onClick={() => {
                  onJump(e.anchor);
                  if (expandable && !isOpen) setOpen((prev) => toggle(prev, e.anchor));
                }}
                aria-current={e.anchor === active ? "location" : undefined}
                className={clsx(
                  "flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left leading-snug",
                  e.anchor === active ? "bg-accent-soft font-medium text-accent" : e.leaf ? "text-muted hover:bg-sunken hover:text-ink" : "text-ink hover:bg-sunken",
                )}
              >
                <span className={clsx("min-w-0", e.leaf ? "truncate" : "line-clamp-2")}>{!q && e.leaf ? e.label.replace(/^\d{1,3}(?:\s?[a-z])? kap\. (?=\d)/, "") : e.label}</span>
                {marked.has(e.anchor) && <span className="size-1.5 shrink-0 rounded-full bg-ok" title="Finns i underlaget" aria-label="I underlaget" />}
              </button>
            </li>
          );
        })}
        {q && visible.length === 0 && <li className="px-3 py-2 text-xs text-muted">Inga avsnitt matchar.</li>}
      </ul>
    </div>
  );
}

function toggle(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
