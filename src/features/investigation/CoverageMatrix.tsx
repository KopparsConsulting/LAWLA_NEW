/**
 * Täckningsmatris: en rad per rättskälla, en kolumn per rättsfråga (och den samlade analysen).
 * Rutorna visar hur många gånger analysen hänvisar till källan. Läsbar även på mobil – raderna
 * växer nedåt och kolumnerna är få.
 */
import { Fragment } from "react";
import clsx from "clsx";
import { NODE_KIND_LABELS, SOURCE_KIND_LABELS, worstLevel, type Graph, type GraphNode, type Matrix, type MatrixRow, type SourceKind, type Warning } from "./graph";
import { LevelIcon, nodeFill } from "./graphUi";

export function CoverageMatrix({
  matrix,
  graph,
  warnings,
  selected,
  onSelect,
}: {
  matrix: Matrix;
  graph: Graph;
  warnings: Map<string, Warning[]>;
  selected: string | null;
  /** Väljer en nod; `via` är kolumnen (rättsfrågan) när en ruta klickas. */
  onSelect: (id: string, via?: string | null) => void;
}) {
  const { columns, rows, missing, unused } = matrix;
  const suggested = graph.nodes.filter((n) => n.kind === "suggested").sort((a, b) => b.weight - a.weight);
  const groups: [SourceKind, MatrixRow[]][] = [];
  for (const r of rows) {
    const kind = r.node.sourceKind ?? "ovrigt";
    const last = groups[groups.length - 1];
    if (last && last[0] === kind) last[1].push(r);
    else groups.push([kind, [r]]);
  }
  const columnTotals = columns.map((_, i) => rows.reduce((s, r) => s + (r.cells[i] ?? 0), 0));
  const span = columns.length + 2;

  if (columns.length === 0) {
    return <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">Utredningen har inga rättsfrågor ännu, så det finns inget att visa i matrisen.</p>;
  }

  return (
    <div className="space-y-4">
      <ol className="grid gap-1 text-xs sm:grid-cols-2">
        {columns.map((c) => {
          const level = worstLevel(warnings.get(c.id));
          return (
            <li key={c.id}>
              <button
                onClick={() => onSelect(c.id)}
                className={clsx("flex w-full items-start gap-2 rounded-md px-2 py-1 text-left hover:bg-sunken", selected === c.id && "bg-accent-soft")}
              >
                <span className="w-11 shrink-0 font-serif font-semibold text-accent">{c.short}</span>
                <span className="min-w-0 flex-1 leading-snug text-ink">{c.kind === "analysis" ? NODE_KIND_LABELS.analysis : c.label}</span>
                {level && level !== "info" && <LevelIcon level={level} />}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">Antal hänvisningar per rättskälla och rättsfråga</caption>
          <thead>
            <tr className="border-b border-line bg-sunken/60 text-muted">
              <th scope="col" className="sticky left-0 z-10 min-w-40 bg-sunken px-3 py-2 text-left font-semibold">
                Rättskälla
              </th>
              {columns.map((c, i) => {
                const level = worstLevel(warnings.get(c.id));
                return (
                  <th key={c.id} scope="col" className="px-1 py-2 text-center font-semibold">
                    <button
                      onClick={() => onSelect(c.id)}
                      title={c.label}
                      className={clsx("inline-flex min-w-9 items-center justify-center gap-0.5 rounded px-1.5 py-0.5 hover:bg-surface", columnTotals[i] === 0 && "text-warn")}
                    >
                      {c.short}
                      {level && level !== "info" && <LevelIcon level={level} className="size-3" />}
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="px-2 py-2 text-center font-semibold" title="Totalt antal hänvisningar">
                Σ
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={span} className="px-3 py-4 text-center text-muted">
                  Ingen analys hänvisar till underlaget ännu.
                </td>
              </tr>
            )}
            {groups.map(([kind, list]) => (
              <Fragment key={kind}>
                <GroupHeader span={span}>{SOURCE_KIND_LABELS[kind]}</GroupHeader>
                {list.map((r) => (
                  <Row key={r.node.id} row={r} columns={columns} selected={selected} onSelect={onSelect} />
                ))}
              </Fragment>
            ))}
            {missing.length > 0 && (
              <>
                <GroupHeader span={span} danger>
                  Saknas i underlaget
                </GroupHeader>
                {missing.map((r) => (
                  <Row key={r.node.id} row={r} columns={columns} selected={selected} onSelect={onSelect} danger />
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {unused.length > 0 && (
        <details className="rounded-lg border border-line bg-surface p-3 text-xs">
          <summary className="cursor-pointer text-muted">
            {unused.length} {unused.length === 1 ? "rättskälla används" : "rättskällor används"} inte av någon analys
          </summary>
          <ul className="mt-2 space-y-0.5">
            {unused.map((n) => (
              <li key={n.id}>
                <NodeButton node={n} selected={selected === n.id} onClick={() => onSelect(n.id)} />
              </li>
            ))}
          </ul>
        </details>
      )}

      {suggested.length > 0 && (
        <div className="rounded-lg border border-dashed border-accent/50 bg-surface p-3 text-xs">
          <p className="font-medium text-ink">Föreslagna källor</p>
          <p className="mt-0.5 text-muted">Dokument som källorna i underlaget hänvisar till, men som inte finns med. Klicka för att lägga till.</p>
          <ul className="mt-2 space-y-0.5">
            {suggested.map((n) => (
              <li key={n.id}>
                <NodeButton node={n} selected={selected === n.id} onClick={() => onSelect(n.id)} note={n.weight > 1 ? `${n.weight} källor hänvisar hit` : undefined} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function GroupHeader({ span, danger, children }: { span: number; danger?: boolean; children: string }) {
  return (
    <tr>
      <th
        scope="colgroup"
        colSpan={span}
        className={clsx("border-t border-line px-3 pb-1 pt-3 text-left text-[11px] font-semibold uppercase tracking-wide", danger ? "text-danger" : "text-muted")}
      >
        {children}
      </th>
    </tr>
  );
}

function Row({
  row,
  columns,
  selected,
  onSelect,
  danger,
}: {
  row: MatrixRow;
  columns: GraphNode[];
  selected: string | null;
  onSelect: (id: string, via?: string | null) => void;
  danger?: boolean;
}) {
  const active = selected === row.node.id;
  return (
    <tr className={clsx("border-t border-line/60", active && "bg-accent-soft/50")}>
      <th scope="row" className={clsx("sticky left-0 z-10 max-w-56 px-3 py-1.5 text-left font-normal", active ? "bg-accent-soft" : "bg-surface")}>
        <NodeButton node={row.node} selected={active} onClick={() => onSelect(row.node.id)} danger={danger} />
      </th>
      {row.cells.map((count, i) => {
        const col = columns[i]!;
        return (
          <td key={col.id} className="px-1 py-1 text-center">
            {count > 0 ? (
              <button
                onClick={() => onSelect(row.node.id, col.id)}
                title={`${col.short}: ${count} ${count === 1 ? "hänvisning" : "hänvisningar"} – visa var`}
                aria-label={`${row.node.label} i ${col.short}: ${count} ${count === 1 ? "hänvisning" : "hänvisningar"}`}
                className={clsx(
                  "inline-flex size-7 items-center justify-center rounded-full font-semibold transition hover:scale-110",
                  danger ? "bg-danger/10 text-danger" : "bg-accent-soft text-accent",
                )}
                style={!danger ? { opacity: Math.min(1, 0.55 + count * 0.15) } : undefined}
              >
                {count}
              </button>
            ) : (
              <span className="text-line" aria-hidden>
                ·
              </span>
            )}
          </td>
        );
      })}
      <td className="px-2 py-1 text-center font-serif text-sm text-muted">{row.total}</td>
    </tr>
  );
}

function NodeButton({ node, selected, onClick, danger, note }: { node: GraphNode; selected: boolean; onClick: () => void; danger?: boolean; note?: string }) {
  const outside = node.kind === "missing" || node.kind === "suggested";
  return (
    <button onClick={onClick} className={clsx("flex w-full items-start gap-2 rounded text-left hover:underline", selected && "font-medium")} title={node.sub ?? node.label}>
      <span
        className={clsx(
          "mt-0.5 size-2.5 shrink-0 rounded-full",
          node.kind === "missing" && "border border-dashed border-danger",
          node.kind === "suggested" && "border border-dashed border-accent",
        )}
        style={{ background: outside ? "transparent" : nodeFill(node) }}
      />
      <span className={clsx("min-w-0 flex-1 leading-snug", danger ? "text-danger" : node.kind === "suggested" ? "text-accent" : "text-ink")}>
        {node.label}
        {note && <span className="ml-1 text-muted">· {note}</span>}
      </span>
    </button>
  );
}
