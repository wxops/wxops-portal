import { cn } from "@/lib/utils";

/**
 * Semantic status tones, kept separate from the brand accent so that "this is
 * healthy" never depends on which colour the product happens to use.
 */
export type StatusTone = "positive" | "warning" | "critical" | "info" | "muted";

const TONE_CLS: Record<StatusTone, string> = {
  positive: "border-wxops-green/20 bg-wxops-green/10 text-wxops-green",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  critical: "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400",
  info: "border-wxops-cyan/20 bg-wxops-cyan/10 text-wxops-cyan",
  muted: "border-border bg-muted/40 text-muted-foreground",
};

const DOT_CLS: Record<StatusTone, string> = {
  positive: "bg-wxops-green",
  warning: "bg-amber-500",
  critical: "bg-red-500",
  info: "bg-wxops-cyan",
  muted: "bg-muted-foreground/40",
};

interface StatusChipProps {
  tone: StatusTone;
  label: string;
  /** Pulse the dot — reserve for states that are actively changing. */
  pulse?: boolean;
  className?: string;
}

/**
 * Small pill with a leading state dot. Used anywhere a resource's condition has
 * to read at a glance rather than be parsed.
 */
export function StatusChip({ tone, label, pulse = false, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        TONE_CLS[tone],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", DOT_CLS[tone], pulse && "animate-status")} />
      {label}
    </span>
  );
}

/**
 * ArgoCD sync state → tone.
 * OutOfSync is a warning rather than an error: it is the normal resting state
 * for staging and production, which are deliberately gated on a manual sync.
 */
export function syncTone(sync: string): StatusTone {
  switch (sync) {
    case "Synced":
      return "positive";
    case "OutOfSync":
      return "warning";
    default:
      return "muted";
  }
}

/** ArgoCD health state → tone. */
export function healthTone(health: string): StatusTone {
  switch (health) {
    case "Healthy":
      return "positive";
    case "Progressing":
      return "info";
    case "Degraded":
      return "critical";
    case "Suspended":
      return "warning";
    case "Missing":
      return "muted";
    default:
      return "muted";
  }
}

/** Health states worth animating — the ones that are mid-flight. */
export function isTransitional(health: string): boolean {
  return health === "Progressing";
}
