import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-medium transition-opacity duration-150 disabled:pointer-events-none disabled:opacity-40 min-h-11 px-5",
  {
    variants: {
      variant: {
        primary: "bg-teal text-warm-fg rounded-md hover:opacity-90",
        ghost: "bg-transparent text-fg rounded-md hover:bg-border/60",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function Button({
  className,
  variant,
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant }), className)} {...props} />;
}
