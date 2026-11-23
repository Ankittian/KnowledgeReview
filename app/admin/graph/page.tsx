import type { Metadata } from "next";
import { GraphExplorer } from "@/components/admin/graph/GraphExplorer";

export const metadata: Metadata = { title: "Knowledge graph" };

export default function GraphPage() {
  return <GraphExplorer />;
}
