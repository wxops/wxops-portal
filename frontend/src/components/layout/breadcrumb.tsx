"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

// Maps known static URL segments to readable labels
const segmentLabels: Record<string, string> = {
  dashboard: "Overview",
  catalog:   "Service Catalog",
  clusters:  "Clusters",
  settings:  "Settings",
};

// These are structural/kind segments — skip them, keep only the entity name after them
const kindSegments = new Set([
  "systems", "Doc", "Component", "API", "Resource",
  "Group", "User", "groups", "users",
]);

function toLabel(segment: string): string {
  return segmentLabels[segment] ?? segment;
}

export function Breadcrumb() {
  const pathname = usePathname();

  // e.g. /dashboard/catalog/systems/payments → ["dashboard", "catalog", "systems", "payments"]
  const raw = pathname.split("/").filter(Boolean);

  // Build display items: [{ label, href }]
  const items: { label: string; href: string }[] = [];
  let hrefAcc = "";

  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i];
    hrefAcc += `/${seg}`;

    if (kindSegments.has(seg)) {
      // Skip kind segments; the next segment (entity name) will be picked up normally
      continue;
    }

    items.push({ label: toLabel(seg), href: hrefAcc });
  }

  // Don't render anything on the top-level dashboard — header already says "Overview"
  if (items.length <= 1) return null;

  return (
    <nav className="flex items-center gap-1 text-sm min-w-0">
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <span key={item.href} className="flex items-center gap-1 min-w-0">
            {i > 0 && (
              <span className="text-muted-foreground/50 shrink-0 select-none">/</span>
            )}
            {isLast ? (
              <span className="font-medium text-foreground truncate max-w-[180px]">
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[140px]"
              >
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
