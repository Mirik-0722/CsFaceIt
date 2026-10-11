import { cn } from "cn"

// A loading placeholder (spec 7): a 1px outline, because the fill alone is close to invisible on the page background.
// It does not animate.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-none border border-border bg-secondary", className)}
      {...props}
    />
  )
}

export { Skeleton }
