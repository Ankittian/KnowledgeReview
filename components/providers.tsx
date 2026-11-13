"use client";

import { ThemeProvider } from "next-themes";
import { MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="kr_theme" disableTransitionOnChange>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delay={300}>
          {children}
          <Toaster position="bottom-right" mobileOffset={{ bottom: 88 }} />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
