import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const NEGATIVE = "border-negative text-negative [a]:hover:bg-negative/10"

// A tag (spec 3): 22px, mono 11px/600, upper case by CSS so the text in the DOM stays as it was written. Only the
// `default` tag is filled; the rest are outlines. Result and side are never carried by colour alone: the text says it.
const badgeVariants = cva(
  "group/badge inline-flex h-5.5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-xs border border-transparent px-2 font-mono text-[11px] leading-none font-semibold tracking-[0.06em] whitespace-nowrap uppercase has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline: "border-ring text-foreground [a]:hover:bg-secondary",
        secondary: "border-border text-muted-foreground [a]:hover:bg-secondary",
        positive: "border-positive text-positive [a]:hover:bg-positive/10",
        negative: NEGATIVE,
        destructive: NEGATIVE,
        // Where a match is from, in FACEIT's own orange (the one place the colour is used).
        faceit: "border-faceit text-faceit",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
