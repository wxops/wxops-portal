"use client";

import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
          <a
            href="/auth/login"
            className="inline-flex items-center justify-center w-full rounded-md px-4 py-3 text-sm font-semibold text-white bg-wxops-purple hover:bg-wxops-purple/90 shadow-lg shadow-wxops-purple/25 transition-all"
          >
            Continue with SSO
          </a>
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
