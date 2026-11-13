import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-xl bg-card p-4 shadow-card ring-1 ring-foreground/[0.07]">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-14" />
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-8 w-80 max-w-full rounded-lg" />
        <Skeleton className="ml-auto hidden h-8 w-24 rounded-lg sm:block" />
      </div>
      <div className="overflow-hidden rounded-xl bg-card shadow-card ring-1 ring-foreground/[0.07]">
        <div className="border-b bg-muted/40 px-3 py-2.5">
          <Skeleton className="h-3 w-40" />
        </div>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-3 py-3.5 last:border-0">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
