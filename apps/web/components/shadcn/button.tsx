import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] font-bold whitespace-nowrap transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        // Lime fill, forest text: the one primary action per screen.
        default: "bg-primary text-primary-foreground hover:bg-primary/85",
        // A filled tile one tone off the ground (no outline).
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "text-foreground hover:bg-secondary",
        link: "text-foreground underline underline-offset-4 hover:no-underline",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
        // Wrapped account screens (DESIGN.md, --wr-* tokens in app/account.css). One lime fill per screen.
        lime: "border-2 border-(--wr-ink) bg-(--wr-lime) font-extrabold text-(--wr-ink) hover:bg-(--wr-lime-press) active:scale-[0.98]",
        outline: "border-2 border-(--wr-ink) bg-transparent font-extrabold text-(--wr-ink) hover:bg-(--wr-ink-wash) active:scale-[0.98]",
        "on-night": "border-2 border-(--wr-cream) bg-transparent font-extrabold text-(--wr-cream) hover:bg-(--wr-cream-wash) active:scale-[0.98]",
        danger: "border-2 border-(--wr-ink) bg-transparent font-extrabold text-(--wr-danger-ink) hover:bg-(--wr-coral-wash) active:scale-[0.98]",
      },
      size: {
        default: "t-body h-12 px-6",
        sm: "t-small h-10 px-4",
        lg: "t-body h-14 px-8",
        icon: "size-12",
        "icon-sm": "size-10",
        pill: "h-13 w-full rounded-full px-6 text-[1.0625rem]",
        "pill-sm": "h-11 rounded-full px-5 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
