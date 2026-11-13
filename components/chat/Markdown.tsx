"use client";

import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AnimatePresence, motion } from "motion/react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Copies text and briefly shows a check mark. */
export function CopyButton({ text, label = "Copy", className = "" }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      aria-label={label}
      title={label}
    >
      <span className="relative inline-flex size-3.5">
        <AnimatePresence initial={false} mode="popLayout">
          {done ? (
            <motion.span key="ok" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className="inline-flex">
              <Check className="size-3.5 text-success" />
            </motion.span>
          ) : (
            <motion.span key="copy" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className="inline-flex">
              <Copy className="size-3.5" />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="sr-only sm:not-sr-only">{done ? "Copied" : label}</span>
    </button>
  );
}

const textOf = (node: unknown): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in (node as object)) return textOf((node as { props: { children?: unknown } }).props.children);
  return "";
};

const components: Components = {
  pre({ children }) {
    const code = textOf(children).replace(/\n$/, "");
    const lang = /language-(\w+)/.exec(
      ((Array.isArray(children) ? children[0] : children) as { props?: { className?: string } })?.props?.className ?? "",
    )?.[1];
    return (
      <div className="group/code relative my-4 overflow-hidden rounded-lg bg-muted/50 ring-1 ring-foreground/[0.08]">
        <div className="flex h-9 items-center justify-between border-b border-foreground/[0.06] pr-1 pl-3">
          <span className="font-mono text-[11px] text-muted-foreground">{lang ?? "code"}</span>
          <CopyButton text={code} label="Copy code" />
        </div>
        <pre className="overflow-x-auto p-3.5 font-mono text-[13px] leading-relaxed">{children}</pre>
      </div>
    );
  },
  code({ className, children }) {
    if (className) return <code className={className}>{children}</code>;
    return <code className="rounded-[5px] bg-muted px-1.5 py-0.5 font-mono text-[0.85em] ring-1 ring-foreground/[0.06]">{children}</code>;
  },
  table({ children }) {
    return (
      <div className="my-4 overflow-x-auto rounded-lg ring-1 ring-foreground/[0.08]">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th className="border-b bg-muted/50 px-3 py-2 text-left text-xs font-medium text-muted-foreground">{children}</th>;
  },
  td({ children }) {
    return <td className="border-b border-foreground/[0.05] px-3 py-2 align-top">{children}</td>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary">
        {children}
      </a>
    );
  },
  ul({ children }) {
    return <ul className="my-2.5 list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="my-2.5 list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>;
  },
  p({ children }) {
    return <p className="my-2.5 leading-7 first:mt-0 last:mb-0">{children}</p>;
  },
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  h1: ({ children }) => <h3 className="mt-6 mb-2 text-lg font-semibold tracking-tight first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-5 mb-2 text-base font-semibold tracking-tight first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-4 mb-1.5 font-semibold first:mt-0">{children}</h4>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-primary/40 pl-3 text-muted-foreground">{children}</blockquote>,
  hr: () => <hr className="my-5 border-border" />,
  img: ({ alt }) => <span className="text-muted-foreground">[image: {alt}]</span>, // no remote images
};

/** Markdown for answers (REQ-CHAT-10). Raw HTML is never rendered (react-markdown escapes it by default). */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="text-[15px] break-words text-foreground/90">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});
