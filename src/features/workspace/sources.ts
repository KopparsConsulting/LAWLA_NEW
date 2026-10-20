/**
 * Datalager för arbetsytan: läser in en rättskälla som block (korpus eller lagen.nu) och
 * kopplar utredningens underlag till rätt block och textställe.
 */
import { useQuery } from "@tanstack/react-query";
import { documentsApi, lagenApi } from "@/api/client";
import type { ExpandedEvidenceDto } from "@/api/types";
import {
  buildToc,
  chunksToBlocks,
  fragmentOf,
  lagenUriIn,
  parseLagenMarkdown,
  shortSourceName,
  sourceKey,
  stripFragment,
  type SourceBlock,
  type SourceRef,
  type TocEntry,
} from "../../../shared/sourceDoc";

export interface LoadedSource {
  ref: SourceRef;
  key: string;
  title: string;
  identifier: string | null;
  /** Kort namn för fliken. */
  short: string;
  /** Typ som text, t.ex. "Lag", "Proposition". */
  typeLabel: string | null;
  blocks: SourceBlock[];
  toc: TocEntry[];
  /** Länk till källan utanför Lawla (lagen.nu eller originalkälla). */
  externalUrl: string | null;
  truncated: boolean;
}

const LAGEN_KIND: Record<string, string> = {
  lag: "Lag",
  forordning: "Förordning",
  prop: "Proposition",
  sou: "SOU",
  ds: "Ds",
  bet: "Betänkande",
  case: "Rättsfall",
};

export function useSource(ref: SourceRef | null) {
  return useQuery({
    queryKey: ["ws-source", ref ? sourceKey(ref) : null],
    enabled: !!ref,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<LoadedSource> => {
      const r = ref!;
      if (r.kind === "doc") {
        const [doc, chunks] = await Promise.all([documentsApi.get(r.documentId), documentsApi.chunks(r.documentId)]);
        const blocks = chunksToBlocks(chunks);
        return {
          ref: r,
          key: sourceKey(r),
          title: doc.title || "Utan titel",
          identifier: doc.canonicalId,
          short: shortSourceName(doc.title, doc.canonicalId),
          typeLabel: doc.documentType,
          blocks,
          toc: buildToc(blocks),
          externalUrl: doc.source && /^https?:\/\//.test(doc.source) ? doc.source : null,
          truncated: false,
        };
      }
      const doc = await lagenApi.doc(r.uri);
      const blocks = parseLagenMarkdown(doc.markdown, doc.uri);
      return {
        ref: r,
        key: sourceKey(r),
        title: doc.title || doc.identifier || "Källa från lagen.nu",
        identifier: doc.identifier,
        short: shortSourceName(doc.title, doc.identifier),
        typeLabel: (doc.kind && LAGEN_KIND[doc.kind]) || doc.kind,
        blocks,
        toc: buildToc(blocks),
        externalUrl: doc.uri,
        truncated: doc.truncated,
      };
    },
  });
}

/** Var en rättskälla i underlaget finns: vilken källa och vilket block. */
export function evidenceLocation(e: ExpandedEvidenceDto): { ref: SourceRef; anchor: string | null } | null {
  if (e.documentId != null) return { ref: { kind: "doc", documentId: e.documentId }, anchor: e.chunkId != null ? `chunk-${e.chunkId}` : null };
  const uri = lagenUriIn(e.annotation);
  if (uri) return { ref: { kind: "lagen", uri: stripFragment(uri) }, anchor: fragmentOf(uri) };
  return null;
}

/** Underlag som hör till en viss källa, per block (ankare). Poster utan ankare hamnar under "". */
export function evidenceByAnchor(evidence: ExpandedEvidenceDto[], key: string): Map<string, ExpandedEvidenceDto[]> {
  const out = new Map<string, ExpandedEvidenceDto[]>();
  for (const e of evidence) {
    const loc = evidenceLocation(e);
    if (!loc || sourceKey(loc.ref) !== key) continue;
    const a = loc.anchor ?? "";
    out.set(a, [...(out.get(a) ?? []), e]);
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Var i blockets text ett sparat textställe står (för markering). Null om det inte går att hitta. */
export function findPassage(text: string, passage: string | null | undefined): [number, number] | null {
  const words = passage?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length === 0) return null;
  const head = words.slice(0, 40);
  const m = new RegExp(head.map(esc).join("\\s+"), "i").exec(text);
  if (!m) return null;
  const start = m.index;
  if (words.length <= 40) return [start, start + m[0].length];
  // Långt textställe: markera fram till dess sista ord om de hittas, annars ungefärlig längd.
  const tail = new RegExp(words.slice(-8).map(esc).join("\\s+"), "i");
  const rest = text.slice(start);
  const t = tail.exec(rest);
  return [start, t ? start + t.index + t[0].length : Math.min(text.length, start + passage!.length)];
}

export interface Range {
  start: number;
  end: number;
  kind: "search" | "current" | "evidence" | "pending";
}

/** Delar texten i segment där överlappande markeringar slås ihop (sökträff går före underlag). */
export function segment(text: string, ranges: Range[]): { text: string; kinds: Set<Range["kind"]>; matchIndex?: number }[] {
  if (ranges.length === 0) return [{ text, kinds: new Set() }];
  const cuts = new Set<number>([0, text.length]);
  for (const r of ranges) {
    cuts.add(Math.max(0, Math.min(text.length, r.start)));
    cuts.add(Math.max(0, Math.min(text.length, r.end)));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: { text: string; kinds: Set<Range["kind"]> }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (a === b) continue;
    const kinds = new Set(ranges.filter((r) => r.start <= a && r.end >= b).map((r) => r.kind));
    const prev = out[out.length - 1];
    if (prev && sameKinds(prev.kinds, kinds)) prev.text += text.slice(a, b);
    else out.push({ text: text.slice(a, b), kinds });
  }
  return out;
}

function sameKinds(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((k) => b.has(k));
}

export interface Match {
  anchor: string;
  start: number;
  end: number;
}

/** Alla träffar för en sökning i källan (skiftlägesokänslig), i textordning. */
export function searchBlocks(blocks: SourceBlock[], query: string, max = 2000): Match[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: Match[] = [];
  for (const b of blocks) {
    const t = b.text.toLowerCase();
    let i = t.indexOf(q);
    while (i !== -1 && out.length < max) {
      out.push({ anchor: b.anchor, start: i, end: i + q.length });
      i = t.indexOf(q, i + q.length);
    }
    if (out.length >= max) break;
  }
  return out;
}
