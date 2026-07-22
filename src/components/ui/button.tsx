import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap border-2 text-sm font-bold outline-none select-none transition-[filter,scale] duration-150 ease-[var(--ease-out)] focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-55 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-xp-shadow border-t-xp-highlight border-l-xp-highlight bg-secondary text-secondary-foreground shadow-[1px_1px_0_var(--xp-shadow-deep)] active:border-xp-highlight active:border-t-xp-shadow active:border-l-xp-shadow active:shadow-none",
        primary:
          "border-primary-foreground/70 border-r-xp-shadow-deep border-b-xp-shadow-deep bg-primary text-primary-foreground shadow-[2px_2px_0_var(--xp-shadow-deep)]",
        outline:
          "border-border bg-card text-card-foreground shadow-none hover:bg-accent hover:text-accent-foreground",
        secondary: "border-xp-shadow bg-secondary text-secondary-foreground",
        ghost:
          "border-transparent bg-transparent text-foreground shadow-none hover:bg-accent hover:text-accent-foreground",
        destructive:
          "border-destructive-foreground/70 border-r-xp-shadow-deep border-b-xp-shadow-deep bg-destructive text-destructive-foreground",
        link: "border-transparent bg-transparent text-primary shadow-none underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-7 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-4 text-base has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        icon: "size-9",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
