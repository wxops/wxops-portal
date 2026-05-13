"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, AlertCircle, LogIn } from "lucide-react";

interface ClusterTokenData {
  token: string;
  audience: string;
  expiresAt: number;
}

interface ClusterConnectButtonProps {
  clusterId: string;
  clusterName: string;
  hasSupervisor: boolean;
}

function getStoredToken(clusterId: string): ClusterTokenData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`cluster_token_${clusterId}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as ClusterTokenData;
    if (data.expiresAt <= Date.now()) {
      sessionStorage.removeItem(`cluster_token_${clusterId}`);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function ClusterConnectButton({ clusterId, clusterName, hasSupervisor }: ClusterConnectButtonProps) {
  const [status, setStatus] = useState<"idle" | "waiting" | "connected" | "error">("idle");
  const [tokenData, setTokenData] = useState<ClusterTokenData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Use refs so the interval/message callbacks always see fresh values.
  const statusRef = useRef(status);
  const messageHandlerRef = useRef<((e: MessageEvent) => void) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Restore token from sessionStorage on mount.
  useEffect(() => {
    const stored = getStoredToken(clusterId);
    if (stored) {
      setTokenData(stored);
      setStatus("connected");
    }
  }, [clusterId]);

  // Clean up listeners on unmount.
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (messageHandlerRef.current) {
        window.removeEventListener("message", messageHandlerRef.current);
      }
    };
  }, []);

  function handleLogin() {
    // Clean up any previous flow.
    if (pollRef.current) clearInterval(pollRef.current);
    if (messageHandlerRef.current) {
      window.removeEventListener("message", messageHandlerRef.current);
    }

    setStatus("waiting");
    setErrorMsg("");

    // Build message handler closed over current clusterId.
    const messageHandler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.cluster_id !== clusterId) return;

      // Received a response — clean up.
      window.removeEventListener("message", messageHandler);
      messageHandlerRef.current = null;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }

      if (data.type === "cluster-auth-success") {
        const stored: ClusterTokenData = {
          token: data.id_token as string,
          audience: data.audience as string,
          // Pinniped issues short-lived tokens; store with 15-min pessimistic expiry.
          expiresAt: Date.now() + 15 * 60 * 1000,
        };
        sessionStorage.setItem(`cluster_token_${clusterId}`, JSON.stringify(stored));
        setTokenData(stored);
        setStatus("connected");
      } else if (data.type === "cluster-auth-error") {
        setErrorMsg((data.error as string) || "Authentication failed");
        setStatus("error");
      }
    };

    messageHandlerRef.current = messageHandler;
    window.addEventListener("message", messageHandler);

    const popup = window.open(
      `/api/v1/clusters/${clusterId}/auth/start`,
      `cluster-auth-${clusterId}`,
      "width=600,height=700,scrollbars=yes,resizable=yes,menubar=no,toolbar=no,location=no",
    );

    if (!popup) {
      window.removeEventListener("message", messageHandler);
      messageHandlerRef.current = null;
      setErrorMsg("Popup blocked — please allow popups for this site.");
      setStatus("error");
      return;
    }

    // Detect if the user closes the popup without completing the flow.
    pollRef.current = setInterval(() => {
      if (popup.closed) {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        if (messageHandlerRef.current) {
          window.removeEventListener("message", messageHandlerRef.current);
          messageHandlerRef.current = null;
        }
        if (statusRef.current === "waiting") {
          setStatus("idle");
        }
      }
    }, 500);
  }

  if (!hasSupervisor) {
    return (
      <Button size="sm" variant="outline" disabled className="h-8 cursor-not-allowed opacity-60">
        No Supervisor
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        variant={status === "connected" ? "outline" : "default"}
        disabled={status === "waiting"}
        onClick={handleLogin}
        className="h-8"
        title={status === "connected" ? `Reconnect to ${clusterName}` : `Login to ${clusterName} via Pinniped`}
      >
        {status === "waiting" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {status === "connected" && <CheckCircle className="mr-1 h-3 w-3 text-green-500" />}
        {status === "error" && <AlertCircle className="mr-1 h-3 w-3 text-red-500" />}
        {status === "idle" && <LogIn className="mr-1 h-3 w-3" />}
        {status === "idle"
          ? "Login to Cluster"
          : status === "waiting"
            ? "Waiting for login..."
            : status === "connected"
              ? "Reconnect"
              : "Retry"}
      </Button>

      {status === "connected" && tokenData && (
        <div className="rounded-md border bg-muted/50 p-2 text-xs space-y-0.5">
          <p className="font-medium text-green-600 dark:text-green-400">Authenticated</p>
          <p className="text-muted-foreground truncate">Audience: {tokenData.audience}</p>
        </div>
      )}

      {status === "error" && (
        <p className="text-xs text-red-500">{errorMsg}</p>
      )}
    </div>
  );
}

