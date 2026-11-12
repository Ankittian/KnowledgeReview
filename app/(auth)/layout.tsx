import { Logo } from "@/components/shell/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] max-w-none -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute right-[-120px] bottom-[-160px] h-[360px] w-[360px] rounded-full bg-success/10 blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo size="lg" />
        </div>
        {children}
      </div>
    </main>
  );
}
