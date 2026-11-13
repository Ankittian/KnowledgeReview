"use client";

import NumberFlow, { type Format } from "@number-flow/react";

/** Digit-rolling number (NumberFlow). Pass `percent` for 0..1 ratios. */
export function AnimatedNumber({
  value,
  percent = false,
  decimals,
  suffix,
  prefix,
  className,
}: {
  value: number;
  percent?: boolean;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const format: Format = percent
    ? { style: "percent", maximumFractionDigits: decimals ?? 0 }
    : { maximumFractionDigits: decimals ?? 0, minimumFractionDigits: decimals ?? 0 };
  return <NumberFlow value={value} format={format} suffix={suffix} prefix={prefix} className={className} willChange />;
}
