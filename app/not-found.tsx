import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="text-5xl font-bold text-primary">404</p>
      <p className="text-muted">This page doesn’t exist.</p>
      <Link href="/" className="btn btn-primary">Go home</Link>
    </main>
  );
}
