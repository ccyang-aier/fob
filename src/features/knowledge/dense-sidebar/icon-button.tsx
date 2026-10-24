"use client";
import { forwardRef, type ComponentProps } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const IconButton = forwardRef<HTMLButtonElement, ComponentProps<'button'> & { label: string; tooltip?: string; tooltipSide?: 'top' | 'right' | 'bottom' | 'left' }>(function IconButton({ label, tooltip, children, className, tooltipSide = 'right', ...props }, ref) {
  return <Tooltip><TooltipTrigger asChild><button {...props} ref={ref} type="button" aria-label={label} className={cn("fob-action inline-flex items-center justify-center", className)}>{children}</button></TooltipTrigger><TooltipContent side={tooltipSide}>{tooltip ?? label}</TooltipContent></Tooltip>;
});
