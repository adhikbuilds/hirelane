import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "signal" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[12px] font-bold tracking-[-0.01em] " +
  "transition-[background-color,box-shadow,transform,color,border-color] duration-150 ease-out " +
  "active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lane";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-lane text-white shadow-[0_1px_2px_rgb(15_31_26/.2),inset_0_1px_0_rgb(255_255_255/.14)] hover:bg-lane-600 hover:shadow-[0_6px_16px_rgb(15_92_69/.28)]",
  secondary: "border border-line bg-surface text-ink shadow-control hover:border-lane/40 hover:bg-lane-50",
  ghost: "text-ink-2 hover:bg-ink/5 hover:text-ink",
  signal: "bg-signal text-ink shadow-control hover:brightness-95",
  danger: "border border-miss/30 bg-miss-50 text-[#b91c1c] hover:bg-miss/15",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-[14px]",
  md: "h-11 px-5 text-[15px]",
  lg: "h-13 px-7 text-[17px]",
};

/** Class string for anything that must look like a button, such as a Next `<Link>`. */
export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cn(base, variants[variant], sizes[size], className);
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Shown before the label. */
  icon?: ReactNode;
};

export function Button({ variant = "primary", size = "md", loading = false, icon, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}
