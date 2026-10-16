"use client";

import { Bookmark } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { useSaved } from "./useSaved";

export function SaveButton({ slug, className, compact = false }: { slug: string; className?: string; compact?: boolean }) {
  const [saved, toggle] = useSaved(slug);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      data-testid="save-job"
      className={cn(buttonClasses("secondary", compact ? "md" : "md"), saved && "border-lane/50 bg-lane-50 text-lane", className)}
    >
      <Bookmark aria-hidden className={cn("size-4", saved && "fill-current")} />
      {saved ? "Saved" : "Save"}
      <span className="sr-only">{saved ? " on this device" : " to this device"}</span>
    </button>
  );
}
