import { surface } from "@/components/admin/bits";
import { cn } from "@/lib/utils";

/** A settings card: icon, title and a one-line description, then the content. Always open. */
export function SectionCard({
  icon,
  title,
  description,
  tone = "default",
  children,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  tone?: "default" | "warning";
  children: React.ReactNode;
}) {
  return (
    <div className={cn(surface, "space-y-5 p-5")}>
      <div className="flex items-start gap-3">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", tone === "warning" ? "bg-warning/12 text-warning" : "bg-primary/10 text-primary")}>{icon}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-1 text-sm text-pretty text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}
