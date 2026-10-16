import { ArrowUpRight } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { SaveButton } from "./SaveButton";

/** The external apply link plus the local Save. `apply` is already validated by safeHttpUrl. */
export function ApplyActions({ slug, apply, closed, className }: { slug: string; apply: string | null; closed: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {apply && !closed ? (
        <a
          href={apply}
          target="_blank"
          rel="noopener noreferrer nofollow"
          data-testid="apply-link"
          className={cn(buttonClasses("primary", "lg"), "w-full")}
        >
          Apply on employer site
          <ArrowUpRight aria-hidden className="size-5" />
        </a>
      ) : (
        <p className="rounded-[12px] bg-ink/5 px-4 py-3 text-center text-[15px] font-semibold text-ink-2" data-testid="apply-closed">
          {closed ? "This role has closed" : "No apply link published"}
        </p>
      )}
      <SaveButton slug={slug} className="w-full" />
    </div>
  );
}
