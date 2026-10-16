"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * Toasts for the landing. The toaster is mounted inside the landing wrapper, so it inherits the
 * [data-landing="v3"] tokens; filled surface, no border, no shadow.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      data-landing="v3"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "t-small !rounded-[var(--radius)] !border-0 !shadow-none !bg-card !text-card-foreground !font-semibold",
          description: "!text-muted-foreground",
        },
      }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--card-foreground)",
          "--normal-border": "transparent",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
