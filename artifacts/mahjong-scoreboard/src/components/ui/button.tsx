import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-bold border-2 border-ink transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground brutal-shadow hover:-translate-y-[2px] hover:-translate-x-[2px] hover:shadow-[6px_6px_0_hsl(var(--brutal-shadow))] active:translate-y-[2px] active:translate-x-[2px] active:shadow-none",
        destructive: "bg-destructive text-destructive-foreground brutal-shadow hover:-translate-y-[2px] hover:-translate-x-[2px] hover:shadow-[6px_6px_0_hsl(var(--brutal-shadow))] active:translate-y-[2px] active:translate-x-[2px] active:shadow-none",
        outline: "bg-tile text-ink brutal-shadow hover:-translate-y-[2px] hover:-translate-x-[2px] hover:shadow-[6px_6px_0_hsl(var(--brutal-shadow))] hover:bg-secondary hover:text-secondary-foreground active:translate-y-[2px] active:translate-x-[2px] active:shadow-none",
        secondary: "bg-secondary text-secondary-foreground brutal-shadow hover:-translate-y-[2px] hover:-translate-x-[2px] hover:shadow-[6px_6px_0_hsl(var(--brutal-shadow))] active:translate-y-[2px] active:translate-x-[2px] active:shadow-none",
        ghost: "border-transparent hover:bg-foreground/5 hover:border-foreground/10 active:bg-foreground/10",
        link: "border-transparent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 px-6 py-2 uppercase tracking-wide",
        sm: "h-10 px-4 text-xs uppercase tracking-wide",
        lg: "h-14 px-8 text-base uppercase tracking-wider",
        icon: "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }