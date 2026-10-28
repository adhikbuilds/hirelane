import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * A native checkbox inside a big tappable label. Native on purpose: it works with JavaScript off and adds no client
 * code (the Radix checkbox would). Checked state comes from CSS :has(), so there's nothing to hydrate.
 */
function CheckboxField({
  title,
  description,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "title"> & { title: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label
      data-slot="checkbox-field"
      className={cn(
        "grid cursor-pointer grid-cols-[24px_1fr] items-start gap-3 rounded-2xl border-2 border-(--wr-ink-wash-strong) p-4 has-checked:border-(--wr-ink) has-checked:bg-(--wr-lime-wash) has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-(--wr-ink)",
        className
      )}
    >
      <input type="checkbox" className="mt-0.5 size-6 accent-(--wr-ink) focus-visible:outline-none" {...props} />
      <span>
        <span className="block font-extrabold">{title}</span>
        {description ? <span className="mt-0.5 block text-[0.9375rem] leading-snug text-(--wr-muted-on-cream)">{description}</span> : null}
      </span>
    </label>
  )
}

export { CheckboxField }
