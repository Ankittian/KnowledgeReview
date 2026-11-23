"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ZoomControls({ onIn, onOut, onReset }: { onIn: () => void; onOut: () => void; onReset: () => void }) {
  return (
    <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-lg bg-card shadow-sm ring-1 ring-border">
      <Button size="icon-sm" variant="ghost" className="rounded-none" aria-label="Zoom in" onClick={onIn}><Plus /></Button>
      <Button size="icon-sm" variant="ghost" className="rounded-none" aria-label="Zoom out" onClick={onOut}><Minus /></Button>
      <Button size="icon-sm" variant="ghost" className="rounded-none" aria-label="Fit" onClick={onReset}><Maximize2 /></Button>
    </div>
  );
}
