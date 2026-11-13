import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LogoMark } from "@/components/shell/Logo";

export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <LogoMark className="relative size-10" />
      <div className="relative">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">This page doesn’t exist</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">The link may be broken, or the page may have been removed.</p>
      </div>
      <Link href="/" className={buttonVariants({ className: "relative" })}>
        <ArrowLeft /> Go home
      </Link>
    </main>
  );
}
