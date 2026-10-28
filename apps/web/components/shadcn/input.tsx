import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const inputVariants = cva(
  "h-13 w-full rounded-2xl border-2 border-(--wr-ink) bg-(--wr-paper) px-4 text-[1.0625rem] text-(--wr-ink) placeholder:text-(--wr-muted-on-cream) focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-(--wr-ink) disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-(--wr-danger-ink)",
  {
    variants: {
      variant: {
        default: "",
        // The 6-digit sign-in code: big, spaced, centred.
        code: "text-center text-3xl font-extrabold tracking-[0.35em] tabular-nums",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Input({ className, variant, ...props }: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return <input data-slot="input" className={cn(inputVariants({ variant, className }))} {...props} />
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn("text-[0.9375rem] font-bold text-(--wr-ink)", className)} {...props} />
}

export { Input, Label, inputVariants }
