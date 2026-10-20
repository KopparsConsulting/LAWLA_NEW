import { useState } from "react";
import clsx from "clsx";

/** Text som visas förkortad (några rader) och kan fällas ut, t.ex. ett markerat textställe. */
export function ExpandableText({ text, lines = 3, className }: { text: string; lines?: 2 | 3 | 4 | 6; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 90 || text.split("\n").length > lines;
  const clamp = { 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4", 6: "line-clamp-6" }[lines];
  return (
    <div className={className}>
      <p className={clsx("whitespace-pre-line", !open && clamp)}>{text}</p>
      {long && (
        <button onClick={() => setOpen((v) => !v)} className="mt-0.5 text-xs text-accent hover:underline" aria-expanded={open}>
          {open ? "Visa mindre" : "Visa hela"}
        </button>
      )}
    </div>
  );
}
