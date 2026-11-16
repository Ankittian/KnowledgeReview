import type { ReactNode } from "react";

/** `**bold**` inside a line. Anything else is plain text; nothing is parsed as HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

const BULLET = /^\s*[-•]\s+/;

/**
 * Card answer text: one idea per line. Lines starting with "- " become a bullet list, `**bold**` marks key terms,
 * every other line is a paragraph. This is the whole markup the card generator is allowed to use (docs/prompts/prompt3.txt).
 */
export function RichText({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    if (BULLET.test(lines[i])) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i])) items.push(lines[i++].replace(BULLET, ""));
      blocks.push(
        <ul key={`u${i}`} className="list-disc space-y-1 pl-5 marker:text-primary/60">
          {items.map((it, k) => (
            <li key={k}>{inline(it)}</li>
          ))}
        </ul>,
      );
    } else {
      blocks.push(<p key={`p${i}`}>{inline(lines[i++])}</p>);
    }
  }
  return (
    <div className={className} data-testid={testId}>
      {blocks}
    </div>
  );
}
