import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Class names, with the last one winning: `cn("px-2", props.class)` lets a caller override a component's own
 * padding without `!important` and without the component knowing which utilities it set. `clsx` joins the
 * conditional parts, `twMerge` resolves the conflicts in Tailwind's own grammar (`px-2` + `px-3` = `px-3`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
