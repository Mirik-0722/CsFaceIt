import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "cn"

// A modal dialog (spec 4, the clip order): a square panel with a strong outline, centred over the dimmed page. On a
// phone it takes the width of the window less a gutter, and it scrolls inside when it is taller than the window. It
// does not animate (spec 7). Focus moves into it when it opens and back to what opened it when it closes; Escape and a
// click outside close it.
function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop data-slot="dialog-backdrop" className="fixed inset-0 z-50 bg-background/80" />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-140 -translate-x-1/2 -translate-y-1/2 flex-col gap-5.5 overflow-y-auto border border-line-strong bg-card p-5 text-foreground sm:p-7",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn("heading-section", className)} {...props} />
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

export { Dialog, DialogClose, DialogContent, DialogTitle }
