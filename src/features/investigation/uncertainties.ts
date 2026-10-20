/**
 * Hittar avsnittet där Lawla lyfter osäkerheter i en analys ("## Osäkerheter", "Oklarheter",
 * "Öppna frågor" …) och delar upp det i punkter, så att juristen kan komplettera med
 * omständigheter riktade mot varje punkt.
 */

export interface UncertaintyItem {
  /** Punktens rubrik om den börjar med fetstil, t.ex. "Kraft av beslutet". */
  title: string | null;
  /** Hela punkten som markdown (utan listtecken). */
  markdown: string;
}

export interface UncertaintySplit {
  /** Markdown före avsnittet. */
  before: string;
  /** Rubrikraden som den står, t.ex. "## Osäkerheter". */
  heading: string;
  /** Rubriken som text, t.ex. "Osäkerheter". */
  headingText: string;
  /** Text mellan rubriken och första punkten (ingress), om någon. */
  intro: string;
  items: UncertaintyItem[];
  /** Markdown efter avsnittet. */
  after: string;
}

const HEADING_WORDS = /^(?:identifierade\s+|kvarstående\s+|eventuella\s+|rättsliga\s+)?(?:osäkerhet(?:er|sfaktorer)?|oklarhet(?:er)?|öppna\s+frågor|frågor\s+att\s+utreda|uppgifter\s+som\s+saknas|saknade\s+uppgifter|behov\s+av\s+kompletter\w*)\b/i;

/** Rubrik: "## Osäkerheter", "### 4. Osäkerheter och risker", "**Osäkerheter**" på egen rad. */
function headingInfo(line: string): { level: number; text: string } | null {
  const md = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (md) return { level: md[1]!.length, text: stripNumbering(md[2]!) };
  const bold = line.match(/^\s{0,3}(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/);
  if (bold) return { level: 7, text: stripNumbering(bold[1]!) };
  return null;
}

function stripNumbering(s: string): string {
  return s.replace(/^\s*(?:\d+(?:\.\d+)*|[IVX]+|[a-z])[.)]\s+/i, "").replace(/[*_]/g, "").trim();
}

const LIST_ITEM = /^(\s{0,3})(?:[-*+]|\d+[.)])\s+(.*)$/;

function itemTitle(markdown: string): string | null {
  const m = markdown.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)\s*[:–-]?/);
  if (!m) return null;
  return m[1]!.replace(/[:.]\s*$/, "").trim() || null;
}

export function splitUncertainties(markdown: string): UncertaintySplit | null {
  const lines = markdown.split("\n");
  let start = -1;
  let level = 0;
  let headingText = "";
  for (let i = 0; i < lines.length; i++) {
    const h = headingInfo(lines[i]!);
    if (h && HEADING_WORDS.test(h.text)) {
      start = i;
      level = h.level;
      headingText = h.text;
      break;
    }
  }
  if (start === -1) return null;

  // Avsnittet slutar vid nästa rubrik på samma eller högre nivå (fetstilsrubriker räknas som lägst).
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const h = headingInfo(lines[i]!);
    if (h && (h.level <= level || level === 7)) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start + 1, end);
  const items: string[][] = [];
  const intro: string[] = [];
  let current: string[] | null = null;
  // Under en underrubrik ("### Laga kraft" eller "**Laga kraft**") hör allt till samma punkt.
  let underSub = false;
  for (const line of body) {
    const sub = headingInfo(line);
    if (sub) {
      current = [`**${sub.text}**:`];
      items.push(current);
      underSub = true;
      continue;
    }
    const m = line.match(LIST_ITEM);
    if (m && m[1]!.length <= 1 && !underSub) {
      current = [m[2]!];
      items.push(current);
    } else if (current) {
      current.push(line.replace(/^ {2,4}/, ""));
    } else {
      intro.push(line);
    }
  }

  let parsed = items
    .map((l) => l.join("\n").trim())
    // En underrubrik utan text under är ingen punkt.
    .filter((t) => t && !/^\*\*[^*]+\*\*:$/.test(t));
  let introText = intro.join("\n").trim();
  if (parsed.length === 0) {
    // Inga listpunkter: varje stycke är en punkt.
    parsed = introText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    introText = "";
  }
  if (parsed.length === 0) return null;

  return {
    before: lines.slice(0, start).join("\n"),
    heading: lines[start]!,
    headingText,
    intro: introText,
    items: parsed.map((md) => ({ title: itemTitle(md), markdown: md })),
    after: lines.slice(end).join("\n"),
  };
}

/** Texten som sparas som omständighet: knuten till osäkerheten den besvarar. */
export function circumstanceText(item: UncertaintyItem, answer: string): string {
  const text = answer.trim();
  return item.title ? `${item.title}: ${text}` : text;
}
