import { ChevronDown, Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** One "Export" button that lists the available downloads. Plain links inside a <details>, so it needs no JavaScript. */
export function ExportMenu({ items }: { items: { label: string; href: string }[] }) {
  return (
    <details className="group relative">
      <summary className={cn(buttonVariants({ variant: "outline" }), "cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden")}>
        <Download /> Export <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
        {items.map((i) => (
          <a key={i.href} href={i.href} className="block rounded-md px-3 py-1.5 text-sm hover:bg-accent">
            {i.label}
          </a>
        ))}
      </div>
    </details>
  );
}
