import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's class merger: clsx for conditionals, tailwind-merge so the last conflicting utility wins. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
