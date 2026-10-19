import type { AnchorHTMLAttributes, MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, CircleHelp } from "lucide-react";
import { parseCitationHref, type CitationTarget } from "@/features/investigation/citations";

export interface MarkdownProps {
  children: string;
  /** Anropas när en hänvisning (länk med #lawla:-adress) klickas. Utan denna renderas vanliga länkar. */
  onCitation?: (target: CitationTarget) => void;
}

export default function MarkdownImpl({ children, onCitation }: MarkdownProps) {
  return (
    <div className="prose-lawla">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: (props) => <CitationAwareLink {...props} onCitation={onCitation} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function CitationAwareLink({
  href,
  children,
  onCitation,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown; onCitation?: MarkdownProps["onCitation"] }) {
  delete (rest as { node?: unknown }).node; // hast-noden ska inte hamna på DOM-elementet
  const target = parseCitationHref(href);
  if (!target) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>
        {children}
      </a>
    );
  }
  const missing = target.kind === "search";
  function click(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    onCitation?.(target!);
  }
  return (
    <a
      href={href}
      onClick={click}
      className={
        missing
          ? "citation citation-missing !no-underline rounded-sm border-b border-dashed border-danger/60 !font-normal !text-danger"
          : "citation !no-underline rounded-sm border-b border-accent/40 !font-normal !text-accent hover:bg-accent-soft"
      }
      title={missing ? "Hänvisningen finns inte i utredningens underlag – klicka för att söka" : "Visa textstället i underlaget"}
    >
      {children}
      {missing ? <CircleHelp className="ml-0.5 inline size-3 align-[-1px]" aria-hidden /> : <BookOpen className="ml-0.5 inline size-3 align-[-1px]" aria-hidden />}
    </a>
  );
}
