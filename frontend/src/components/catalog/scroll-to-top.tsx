"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scrollEl = document.querySelector("main");
    if (!scrollEl) return;
    const handler = () => setVisible(scrollEl.scrollTop > 300);
    scrollEl.addEventListener("scroll", handler, { passive: true });
    return () => scrollEl.removeEventListener("scroll", handler);
  }, []);

  const handleClick = () => {
    document.querySelector("main")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Scroll to top"
      className={cn(
        "fixed bottom-6 right-6 z-40 flex h-9 w-9 items-center justify-center",
        "rounded-full border border-border bg-background shadow-md",
        "text-muted-foreground hover:text-foreground hover:bg-muted hover:shadow-lg",
        "transition-all duration-200",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none",
      )}
    >
      <ArrowUp className="h-4 w-4" />
    </button>
  );
}
