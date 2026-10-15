import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownImpl({ children }: { children: string }) {
  return (
    <div className="prose-lawla">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
