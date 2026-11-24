"use client";

import { useFormStatus } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function SubmitButton({ children, icon, className }: { children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className={cn("h-10 w-full text-sm", className)} disabled={pending} aria-busy={pending}>
      {pending ? <Spinner /> : icon}
      {children}
    </Button>
  );
}

export function FormAlert({ message }: { message?: string }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }}>
          <Alert variant="destructive" className="border-destructive/25 bg-destructive/5">
            <AlertCircle />
            <AlertDescription className="text-destructive">{message}</AlertDescription>
          </Alert>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? (
    <motion.p initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} className="mt-1.5 text-xs font-medium text-destructive">
      {message}
    </motion.p>
  ) : null;
}

/** Small text link under a primary button (e.g. switch between password and email-code sign-in). */
export function SwitchLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="mx-auto block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
      {children}
    </button>
  );
}
