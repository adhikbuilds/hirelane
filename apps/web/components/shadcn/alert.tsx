import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const alertVariants = cva("mt-4 rounded-2xl px-4 py-3 leading-snug font-bold text-(--wr-ink)", {
  variants: {
    tone: {
      error: "bg-(--wr-pink)",
      ok: "bg-(--wr-lime)",
    },
  },
  defaultVariants: { tone: "error" },
})

/** Errors are role=alert (announced at once); confirmations are role=status. */
function Alert({ className, tone = "error", ...props }: React.ComponentProps<"p"> & VariantProps<typeof alertVariants>) {
  return <p data-slot="alert" role={tone === "ok" ? "status" : "alert"} className={cn(alertVariants({ tone, className }))} {...props} />
}

export { Alert, alertVariants }
