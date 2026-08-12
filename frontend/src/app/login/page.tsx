"use client";

import { Suspense, useEffect, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Copy for the ?error= codes the backend sends (see failLogin in
 * backend/internal/handlers/auth.go). The codes are opaque by design — the
 * underlying OIDC error can name the issuer and token endpoint, so it never
 * reaches the browser and cannot be recovered from here.
 *
 * `expired` is the common one: it fires whenever the backend restarts between
 * /auth/login and /auth/callback, because the PKCE state is held in memory.
 */
const LOGIN_ERRORS: Record<string, string> = {
  expired:
    "Your sign-in session expired before it could finish. Please try again.",
  server:
    "Something went wrong on our side while signing you in. Please try again.",
  invalid_request:
    "That sign-in attempt was incomplete. Please try again.",
};

const BUTTON_CLASS =
  "inline-flex items-center justify-center gap-2 w-full rounded-md px-4 py-3 text-sm font-semibold text-white bg-wxops-purple hover:bg-wxops-purple/90 shadow-lg shadow-wxops-purple/25 transition-all";

/**
 * The sign-in control on its own, so the Suspense fallback below can render an
 * identical button while useSearchParams resolves — no flash of missing CTA.
 */
function SsoButton({
  href = "/auth/login",
  pending = false,
  onClick,
}: {
  href?: string;
  pending?: boolean;
  onClick?: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      aria-disabled={pending || undefined}
      className={cn(BUTTON_CLASS, pending && "pointer-events-none opacity-80")}
    >
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Redirecting to sign-in…
        </>
      ) : (
        "Continue with SSO"
      )}
    </a>
  );
}

function LoginActions() {
  const searchParams = useSearchParams();
  const [pending, setPending] = useState(false);

  const error    = searchParams.get("error");
  const returnTo = searchParams.get("return_to");

  // Reset on bfcache restore. Without this, a user who clicks sign-in and then
  // presses Back comes home to a button spinning forever — React state survives
  // a back-forward cache restore, but the navigation it was tracking is gone.
  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  // Carry the caller's destination through to the backend, which sanitises it
  // via auth.SafeReturnPath and stores it server-side alongside the PKCE state.
  const href = returnTo
    ? `/auth/login?return_to=${encodeURIComponent(returnTo)}`
    : "/auth/login";

  const message = error
    ? LOGIN_ERRORS[error] ?? LOGIN_ERRORS.invalid_request
    : null;

  return (
    <>
      {message && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-left"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
          <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">
            {message}
          </p>
        </div>
      )}
      {/* Not preventDefault — the OIDC flow needs a real browser navigation. */}
      <SsoButton href={href} pending={pending} onClick={() => setPending(true)} />
    </>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
      {/* Ambient glow — visible in dark, subtle in light */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full bg-wxops-purple/10 blur-3xl dark:bg-wxops-purple/20" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full bg-wxops-cyan/5 blur-3xl dark:bg-wxops-cyan/10" />
      </div>

      <Card className="relative w-full max-w-sm border-border bg-card/90 backdrop-blur-sm shadow-2xl">
        <CardHeader className="space-y-3 text-center pb-4">
          {/* Real WxOps logo */}
          <div className="flex justify-center">
            <Image
              src="/favicon-128x128.png"
              alt="W'xOps"
              width={64}
              height={64}
              className="rounded-2xl shadow-lg"
              priority
            />
          </div>
          <div>
            <CardTitle className="text-2xl font-bold tracking-tight">
              W&apos;xOps Portal
            </CardTitle>
            <CardDescription className="mt-1 text-sm">
              Internal Developer Platform
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Suspense fallback={<SsoButton />}>
            <LoginActions />
          </Suspense>
          <p className="text-xs text-center text-muted-foreground leading-relaxed">
            Authenticated via <span className="text-wxops-cyan font-medium">Dex OIDC</span>.
            <br />
            Group membership controls Kubernetes RBAC access.
          </p>
        </CardContent>
      </Card>

      {/* Footer attribution */}
      <a
        href="https://www.wxops.cloud/"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-wxops-cyan transition-colors"
      >
        <Image src="/favicon-16x16.png" alt="" width={14} height={14} className="rounded opacity-60" />
        <span>wxops.cloud</span>
        <span className="text-muted-foreground/40">·</span>
        <span>You own your infrastructure</span>
      </a>
    </div>
  );
}
