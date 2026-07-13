"use client";

import { useEffect, useRef, useState } from "react";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TocItem {
  level: number;
  text: string;
  id: string;
}

interface DocTocProps {
  items: TocItem[];
}

export function DocToc({ items }: DocTocProps) {
  const [activeId, setActiveId] = useState<string>("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const listRef                 = useRef<HTMLUListElement>(null);
  const itemRefs                = useRef<Map<string, HTMLLIElement>>(new Map());

  useEffect(() => {
    if (items.length === 0) return;

    // The dashboard layout scrolls inside <main class="overflow-y-auto">.
    const scrollEl = document.querySelector("main");
    if (!scrollEl) return;

    // Active = the last heading (in DOM order) whose top edge is within
    // THRESHOLD px of <main>'s top edge (viewport-relative).
    const THRESHOLD = 120;

    const getHeadingEls = (): { id: string; el: HTMLElement }[] =>
      items.flatMap((item) => {
        // Try by id first, then fall back to a direct attribute query.
        const el =
          document.getElementById(item.id) ??
          document.querySelector<HTMLElement>(`[id="${CSS.escape(item.id)}"]`);
        return el ? [{ id: item.id, el }] : [];
      });

    const handleScroll = () => {
      const containerTop = scrollEl.getBoundingClientRect().top;
      let current = "";
      for (const { id, el } of getHeadingEls()) {
        if (el.getBoundingClientRect().top - containerTop <= THRESHOLD) {
          current = id;
        }
      }
      setActiveId((prev) => current || prev);
    };

    // Run once immediately and once on next frame to catch any late paint.
    handleScroll();
    const raf = requestAnimationFrame(handleScroll);

    scrollEl.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      scrollEl.removeEventListener("scroll", handleScroll);
    };
  }, [items]);

  // Scroll the active ToC item into view inside the ToC list only —
  // never touching the main doc scroll container.
  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const li = itemRefs.current.get(activeId);
    if (!li) return;
    const list = listRef.current;
    const { offsetTop, offsetHeight } = li;
    if (offsetTop < list.scrollTop) {
      list.scrollTop = offsetTop - 8;
    } else if (offsetTop + offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = offsetTop + offsetHeight - list.clientHeight + 8;
    }
  }, [activeId]);

  const handleCopyLink = (id: string) => {
    const url = `${window.location.href.split("#")[0]}#${id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  if (items.length === 0) return null;

  const minLevel = Math.min(...items.map((i) => i.level));

  return (
    <div className="hidden xl:block xl:sticky xl:top-6">
      <nav>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-3 px-1">
          On This Page
        </p>

        <ul
          ref={listRef}
          className="space-y-0.5 overflow-y-auto pr-1"
          style={{ maxHeight: "calc(100svh - 10rem)" }}
        >
          {items.map((item) => {
            const indent   = (item.level - minLevel) * 10;
            const isActive = activeId === item.id;

            return (
              <li
                key={item.id}
                ref={(el) => {
                  if (el) itemRefs.current.set(item.id, el);
                  else itemRefs.current.delete(item.id);
                }}
                style={{ paddingLeft: indent }}
              >
                <div className="group flex items-center gap-1">
                  <a
                    href={`#${item.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      const target = document.getElementById(item.id);
                      const scrollEl = document.querySelector("main");
                      if (target && scrollEl) {
                        const delta = target.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
                        scrollEl.scrollBy({ top: delta - 80, behavior: "smooth" });
                      }
                      window.history.replaceState(null, "", `#${item.id}`);
                      setActiveId(item.id);
                    }}
                    className={cn(
                      "flex-1 flex items-center gap-1.5 text-[12px] leading-5 py-1 px-1.5 rounded transition-colors duration-150 min-w-0",
                      isActive
                        ? "text-wxops-purple font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 h-1.5 w-1.5 rounded-full transition-all duration-150",
                        isActive ? "bg-wxops-purple scale-110" : "bg-transparent",
                      )}
                    />
                    <span className="truncate">{item.text}</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => handleCopyLink(item.id)}
                    title="Copy link"
                    className={cn(
                      "shrink-0 rounded p-0.5 transition-all",
                      copiedId === item.id
                        ? "text-green-500 opacity-100"
                        : "text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-foreground",
                    )}
                  >
                    <Link2 className="h-3 w-3" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
