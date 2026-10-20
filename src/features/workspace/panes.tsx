import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import clsx from "clsx";

/** Panelstorlekar som användaren dragit fram – sparas i webbläsaren (bekvämlighet, inte data). */
export interface PaneSizes {
  /** Innehållsförteckningen till vänster, px. */
  left: number;
  /** Analysen till höger när en källa är öppen, px. */
  right: number;
  /** Andel av mittenytan för den vänstra källan när två visas sida vid sida. */
  split: number;
}

const KEY = "lawla.arbetsyta.paneler";
const DEFAULTS: PaneSizes = { left: 260, right: 440, split: 0.5 };

export function usePaneSizes() {
  const [sizes, setSizes] = useState<PaneSizes>(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PaneSizes>) };
    } catch {
      /* privat läge e.d. */
    }
    return DEFAULTS;
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(sizes));
    } catch {
      /* ignoreras */
    }
  }, [sizes]);
  const reset = useCallback(() => setSizes(DEFAULTS), []);
  return { sizes, setSizes, reset };
}

/**
 * Avdelare som dras med mus/finger eller piltangenter. `onDelta` får förflyttningen i px sedan
 * förra händelsen; `side` anger åt vilket håll panelen växer (vänsterpanel växer åt höger).
 */
export function Splitter({
  onDelta,
  onReset,
  label,
  side,
}: {
  onDelta: (dx: number) => void;
  onReset?: () => void;
  label: string;
  side: "left" | "right";
}) {
  const last = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  function down(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = e.clientX;
    setDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }
  function move(e: PointerEvent<HTMLDivElement>) {
    if (last.current == null) return;
    const dx = e.clientX - last.current;
    last.current = e.clientX;
    if (dx) onDelta(side === "left" ? dx : -dx);
  }
  function up() {
    last.current = null;
    setDragging(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }
  function key(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === "ArrowLeft") onDelta(side === "left" ? -step : step);
    else if (e.key === "ArrowRight") onDelta(side === "left" ? step : -step);
    else return;
    e.preventDefault();
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      title={`${label} – dra för att ändra bredd, dubbelklicka för standard`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={onReset}
      onKeyDown={key}
      className="group relative z-10 -mx-1.5 w-3 shrink-0 cursor-col-resize touch-none focus:outline-none"
    >
      <div
        className={clsx(
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors",
          dragging ? "w-0.5 bg-accent" : "bg-line group-hover:w-0.5 group-hover:bg-accent/60 group-focus-visible:w-0.5 group-focus-visible:bg-accent",
        )}
      />
    </div>
  );
}

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** Bredd på ett element, uppdateras vid storleksändring. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/** Sant när fönstret är smalare än lg (1024 px) – då visas en panel i taget. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
