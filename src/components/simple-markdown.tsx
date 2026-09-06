import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A deliberately small Markdown subset: paragraphs, bold, italics, inline code
 * and simple lists and tables.
 *
 * It builds React elements rather than HTML, so nothing here can inject markup
 * — which matters because grammar notes can come from the AI draft tool as well
 * as from the teacher. Anything it does not understand renders as plain text,
 * which is the right failure for teaching material: readable, never broken.
 */

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = `${keyPrefix}-${index}`;

    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      // Italics carry the Slovene examples in the notes, so they get its face.
      return (
        <em key={key} className="slovene not-italic text-foreground">
          {part.slice(1, -1)}
        </em>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="rounded bg-secondary px-1 py-0.5 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

function splitRow(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

const isTableRow = (line: string) => line.startsWith("|") && line.endsWith("|");
const isSeparatorRow = (line: string) => /^\|[\s:|-]+\|$/.test(line);

export function SimpleMarkdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];

  let paragraph: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const key = `p-${blocks.length}`;
    blocks.push(
      <p key={key} className="leading-relaxed">
        {renderInline(paragraph.join(" "), key)}
      </p>,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list.length) return;
    const key = `ul-${blocks.length}`;
    blocks.push(
      <ul key={key} className="flex list-disc flex-col gap-1.5 pl-5 leading-relaxed">
        {list.map((item, index) => (
          <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  const flushTable = () => {
    if (!table.length) return;
    const key = `table-${blocks.length}`;
    const [head, ...body] = table;
    blocks.push(
      <div key={key} className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          {head ? (
            <thead>
              <tr>
                {head.map((cell, index) => (
                  <th
                    key={`${key}-h-${index}`}
                    className="border-b border-border pb-2 pr-4 font-medium text-muted-foreground"
                  >
                    {renderInline(cell, `${key}-h-${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={`${key}-r-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${key}-r-${rowIndex}-${cellIndex}`}
                    className="border-b border-border/50 py-2 pr-4"
                  >
                    {renderInline(cell, `${key}-r-${rowIndex}-${cellIndex}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    table = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }

    if (isTableRow(line)) {
      flushParagraph();
      flushList();
      if (!isSeparatorRow(line)) table.push(splitRow(line));
      continue;
    }

    if (line.startsWith("- ")) {
      flushParagraph();
      flushTable();
      list.push(line.slice(2));
      continue;
    }

    flushList();
    flushTable();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  flushTable();

  return <div className={cn("flex flex-col gap-4", className)}>{blocks}</div>;
}
