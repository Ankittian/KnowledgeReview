"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export interface DayPoint {
  date: string;
  label: string;
  knew: number;
  missed: number;
}

const config = {
  knew: { label: "Knew it", color: "var(--chart-1)" },
  missed: { label: "Not yet", color: "color-mix(in oklch, var(--chart-1) 28%, var(--muted))" },
} satisfies ChartConfig;

/** Cards answered per day, stacked by knew / not yet. */
export function ActivityChart({ data }: { data: DayPoint[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-44 w-full" role="img" aria-label="Cards answered per day over the selected period">
      <BarChart data={data} margin={{ top: 4, right: 0, left: -24, bottom: 0 }} barCategoryGap={3}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={data.length > 14 ? Math.ceil(data.length / 6) - 1 : 0} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} fontSize={11} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltipContent indicator="dot" />} />
        <Bar dataKey="knew" stackId="a" fill="var(--color-knew)" radius={2} animationDuration={700} />
        <Bar dataKey="missed" stackId="a" fill="var(--color-missed)" radius={2} animationDuration={700} />
      </BarChart>
    </ChartContainer>
  );
}
