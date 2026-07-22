"use client";

import type * as React from "react";

import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // The association is supplied by each consumer through htmlFor.
    // biome-ignore lint/a11y/noLabelWithoutControl: this is a composed label primitive.
    <label
      data-slot="label"
      className={cn(
        "inline-flex items-center gap-2 text-sm leading-5 font-bold select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-55 peer-disabled:cursor-not-allowed peer-disabled:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
