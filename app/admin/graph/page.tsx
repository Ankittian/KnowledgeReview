import type { Metadata } from "next";
import { GraphExplorer } from "@/components/admin/graph/GraphExplorer";
import { kgConfigured, kgGraphName } from "@/lib/kg/client";

export const metadata: Metadata = { title: "Knowledge graph" };

export default async function GraphPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { graph } = await searchParams;
  return <GraphExplorer graph={kgGraphName(Array.isArray(graph) ? graph[0] : graph)} newAvailable={kgConfigured("new")} />;
}
