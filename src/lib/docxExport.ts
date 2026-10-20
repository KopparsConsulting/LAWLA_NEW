/**
 * Export av markdown till Word (.docx). `docx`-paketet laddas först när det behövs –
 * det är stort och används bara vid export.
 */
import { parseBlocks, type Inline } from "./mdblocks";

export async function markdownToDocxBlob(markdown: string, meta: { title: string; author?: string | null }): Promise<Blob> {
  const docx = await import("docx");
  const { AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } = docx;

  const runs = (inlines: Inline[]) =>
    inlines.map((i) => new TextRun({ text: i.text, bold: i.bold, italics: i.italic }));

  const headingLevels = [HeadingLevel.TITLE, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5] as const;

  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "D9D4C7" };
  const alignment = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT } as const;
  let listInstance = 0;
  for (const block of parseBlocks(markdown)) {
    switch (block.type) {
      case "heading":
        children.push(new Paragraph({ heading: headingLevels[block.level - 1], children: runs(block.inlines) }));
        break;
      case "paragraph":
        children.push(new Paragraph({ children: runs(block.inlines), spacing: { after: 160 } }));
        break;
      case "quote":
        children.push(
          new Paragraph({
            children: runs(block.inlines.map((i) => ({ ...i, italic: true }))),
            indent: { left: 567 },
            border: { left: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 8 } },
            spacing: { after: 160 },
          }),
        );
        break;
      case "list": {
        const instance = block.ordered ? listInstance++ : 0;
        for (const item of block.items) {
          children.push(
            new Paragraph({
              children: runs(item),
              numbering: block.ordered ? { reference: "numbered", level: 0, instance } : undefined,
              bullet: block.ordered ? undefined : { level: 0 },
              spacing: { after: 60 },
            }),
          );
        }
        break;
      }
      case "table": {
        const row = (cells: typeof block.header, header: boolean) =>
          new TableRow({
            tableHeader: header,
            children: block.header.map(
              (_, i) =>
                new TableCell({
                  borders: { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder },
                  shading: header ? { fill: "EFECE4" } : undefined,
                  margins: { top: 40, bottom: 40, left: 80, right: 80 },
                  children: [
                    new Paragraph({
                      alignment: alignment[block.align[i] ?? "left"],
                      children: runs((cells[i] ?? []).map((x) => ({ ...x, bold: header || x.bold }))),
                    }),
                  ],
                }),
            ),
          });
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row(block.header, true), ...block.rows.map((r) => row(r, false))] }));
        children.push(new Paragraph({ children: [], spacing: { after: 120 } }));
        break;
      }
      case "hr":
        children.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 1 } }, spacing: { before: 200, after: 200 } }));
        break;
    }
  }

  const doc = new Document({
    creator: meta.author || "Lawla",
    title: meta.title,
    description: "Rättsutredning – utkast framtaget med Lawla",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", run: { font: "Georgia", size: 48, bold: true }, paragraph: { spacing: { after: 240 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Georgia", size: 32, bold: true, color: "1F3B63" }, paragraph: { spacing: { before: 360, after: 160 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Georgia", size: 26, bold: true }, paragraph: { spacing: { before: 280, after: 120 } } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 23, bold: true }, paragraph: { spacing: { before: 200, after: 80 } } },
        { id: "Heading4", name: "Heading 4", basedOn: "Normal", next: "Normal", run: { size: 22, bold: true, italics: true }, paragraph: { spacing: { before: 160, after: 60 } } },
        { id: "Heading5", name: "Heading 5", basedOn: "Normal", next: "Normal", run: { size: 22, italics: true }, paragraph: { spacing: { before: 120, after: 60 } } },
      ],
    },
    numbering: {
      config: [
        {
          reference: "numbered",
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START, style: { paragraph: { indent: { left: 567, hanging: 360 } } } }],
        },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 1418, bottom: 1418, left: 1418, right: 1418 } } }, children }],
  });

  return Packer.toBlob(doc);
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
