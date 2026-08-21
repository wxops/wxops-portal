"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

function DialogBackdrop({ className, style, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-backdrop"
      className={cn(
        "z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      // Inline, not just classes: position/inset must never be silently
      // dropped by a class-scanning or HMR gap — this is the one thing that
      // guarantees the backdrop covers exactly the viewport and nothing more.
      style={{ position: "fixed", inset: 0, ...style }}
      {...props}
    />
  )
}

function DialogViewport({ className, style, ...props }: DialogPrimitive.Viewport.Props) {
  return (
    <DialogPrimitive.Viewport
      data-slot="dialog-viewport"
      className={cn("z-50 p-4", className)}
      // Same reasoning as DialogBackdrop: the centering box itself must
      // never accidentally fill the screen, so its geometry is inline.
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
      {...props}
    />
  )
}

function DialogContent({
  className,
  style,
  children,
  showClose = true,
  ...props
}: DialogPrimitive.Popup.Props & { showClose?: boolean }) {
  return (
    <DialogPortal>
      <DialogBackdrop />
      <DialogViewport>
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            "relative flex w-full max-w-2xl flex-col gap-4 rounded-lg border bg-popover p-6 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          // Inline, not just classes: this box must never grow past a
          // fraction of the viewport no matter what — content that
          // overflows scrolls inside the card instead of pushing it, or the
          // card itself, past the screen edge.
          style={{ maxHeight: "min(40rem, 78vh)", overflowY: "auto", ...style }}
          {...props}
        >
          {children}
          {showClose && (
            <DialogPrimitive.Close
              data-slot="dialog-close"
              className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity outline-none hover:opacity-100 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <XIcon className="size-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogViewport>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-6", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex items-center justify-end gap-2", className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-sm font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogBackdrop,
  DialogViewport,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
}
