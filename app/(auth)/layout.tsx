import { CheckCircle2, Layers, MessageSquare, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/shell/Logo";
import { ThemeToggle } from "@/components/shell/ThemeToggle";

const POINTS = [
  { icon: Layers, title: "A few cards a day", text: "Short daily decks built straight from the SpectrumERP knowledge base." },
  { icon: CheckCircle2, title: "Verify as you learn", text: "Mark what is correct and suggest fixes; reviewers see them right away." },
  { icon: MessageSquare, title: "Ask the assistant", text: "Get answers about forms, processes and tables in your own role’s language." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* product panel (desktop) */}
      <aside className="relative hidden overflow-hidden border-r bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-14">
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
        <Logo className="relative" />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold tracking-tight text-balance">Keep the knowledge base right, one card at a time.</h2>
          <ul className="mt-8 space-y-5">
            {POINTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-background shadow-card ring-1 ring-foreground/[0.07]">
                  <Icon className="size-4 text-primary" />
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5" /> Accounts are approved by an administrator.
        </p>
      </aside>

      {/* form side */}
      <main className="relative flex flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <Logo className="lg:invisible" />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </main>
    </div>
  );
}
