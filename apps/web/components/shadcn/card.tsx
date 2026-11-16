import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const cardVariants = cva("rounded-[18px] p-5 sm:p-7", {
  variants: {
    tone: {
      cream: "bg-(--wr-cream) text-(--wr-ink)",
      blue: "bg-(--wr-blue) text-(--wr-cream)",
    },
  },
  defaultVariants: { tone: "cream" },
})

function Card({ className, tone, ...props }: React.ComponentProps<"section"> & VariantProps<typeof cardVariants>) {
  return <section data-slot="card" className={cn(cardVariants({ tone, className }))} {...props} />
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return <h2 data-slot="card-title" className={cn("text-[1.75rem] leading-none font-extrabold tracking-[-0.035em] text-balance", className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("mt-2 text-[0.9375rem] leading-snug text-(--wr-muted-on-cream)", className)} {...props} />
}

/** Tilted colour block behind a straight card: the Wrapped look, with controls that stay easy to use. */
function CardStack({ className, tone = "lime", ...props }: React.ComponentProps<"div"> & { tone?: "lime" | "pink" }) {
  return <div data-slot="card-stack" data-tone={tone} className={cn("wr-stack", className)} {...props} />
}

export { Card, CardDescription, CardStack, CardTitle, cardVariants }
