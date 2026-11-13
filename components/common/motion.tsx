"use client";

import { motion, type HTMLMotionProps, type Variants } from "motion/react";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Fades and lifts its content in once on mount. */
export function FadeIn({ delay = 0, y = 8, className, children, ...rest }: HTMLMotionProps<"div"> & { delay?: number; y?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE, delay }}
      className={className}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: EASE } },
};

/** Staggers the entrance of its direct <StaggerItem> children. */
export function Stagger({ as = "div", className, children }: { as?: "div" | "ul" | "ol"; className?: string; children: React.ReactNode }) {
  const C = as === "ul" ? motion.ul : as === "ol" ? motion.ol : motion.div;
  return (
    <C variants={container} initial="hidden" animate="show" className={className}>
      {children}
    </C>
  );
}

export function StaggerItem({ as = "div", className, children, ...rest }: { as?: "div" | "li"; className?: string; children: React.ReactNode } & Omit<HTMLMotionProps<"div">, "children">) {
  const C = as === "li" ? motion.li : motion.div;
  return (
    <C variants={item} className={className} {...(rest as object)}>
      {children}
    </C>
  );
}

/** A horizontal bar that grows to `value` (0..1) on mount. */
export function GrowBar({ value, className, delay = 0 }: { value: number; className?: string; delay?: number }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <motion.div
      className={className}
      initial={{ width: 0 }}
      animate={{ width: `${v * 100}%` }}
      transition={{ duration: 0.8, ease: EASE, delay }}
    />
  );
}
