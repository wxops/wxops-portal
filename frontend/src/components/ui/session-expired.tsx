"use client";

import { LogIn, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Builds the re-login URL for the page the user is currently on.
 *
 * `/auth/login` is a Go route (nginx sends `/auth/*` straight to the backend),
 * so this is a full navigation rather than a fetch — the OIDC flow needs the
 * browser to follow redirects to the Supervisor and back.
 *
 * The backend passes `return_to` through `auth.SafeReturnPath`, which reduces it
 * to a same-origin path, so a tampered value can never redirect off-site.
 */
function reloginHref(): string {
  if (typeof window === "undefined") return "/auth/login";
  const here = window.location.pathname + window.location.search;
  return `/auth/login?return_to=${encodeURIComponent(here)}`;
}

interface SessionExpiredProps {
  /** What could not be loaded, e.g. "cluster resources". */
  resource?: string;
  /** Render inline (inside a card body) rather than as a standalone block. */
  compact?: boolean;
  className?: string;
}

/**
 * Shown when a request returns 401 because the Pinniped session can no longer be
 * exchanged for cluster credentials.
 *
 * The point of this component is that signing out is *not* required: the session
 * cookie is simply stale, and starting a fresh OIDC flow replaces it in place.
 * Sending the user to Settings to log out and back in would lose their place for
 * no reason, so the button re-authenticates and returns them to this exact page.
 */
export function SessionExpired({ resource, compact = false, className }: SessionExpiredProps) {
  const what = resource ? ` to load ${resource}` : "";

  return (
    <div
      className={cn(
        "rounded-lg border border-amber-500/30 bg-amber-500/5",
        compact ? "p-3" : "p-4",
        className,
      )}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
              Session expired
            </p>
            <p className="text-xs text-muted-foreground">
              Your Kubernetes credentials could not be renewed{what}. Sign in again to
              refresh them — you&apos;ll come straight back to this page.
            </p>
          </div>

          <a
            href={reloginHref()}
            className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-300"
          >
            <LogIn className="h-3.5 w-3.5" />
            Sign in again
          </a>
        </div>
      </div>
    </div>
  );
}

/**
 * True when a fetch Response indicates the session is no longer usable.
 * Kept next to the component so every caller classifies 401 the same way.
 */
export function isSessionExpired(status: number): boolean {
  return status === 401;
}
