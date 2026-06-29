"use client";

import { useState } from "react";
import { Plus, Trash2, Upload, Eye, EyeOff } from "lucide-react";

export interface KVPair {
  key: string;
  value: string;
}

interface KeyValueEditorProps {
  pairs: KVPair[];
  onChange: (pairs: KVPair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  allowImport?: boolean;
  secret?: boolean;
}

export function KeyValueEditor({
  pairs,
  onChange,
  keyPlaceholder = "KEY",
  valuePlaceholder = "value",
  allowImport,
  secret,
}: KeyValueEditorProps) {
  const [allVisible, setAllVisible] = useState(false);
  const [visibleRows, setVisibleRows] = useState<Set<number>>(() => new Set());

  const update = (idx: number, field: "key" | "value", val: string) => {
    const next = [...pairs];
    next[idx] = { ...next[idx], [field]: val };
    onChange(next);
  };

  const add = () => onChange([...pairs, { key: "", value: "" }]);

  const remove = (idx: number) => {
    onChange(pairs.filter((_, i) => i !== idx));
    setVisibleRows((prev) => {
      const next = new Set<number>();
      prev.forEach((v) => {
        if (v < idx) next.add(v);
        else if (v > idx) next.add(v - 1);
      });
      return next;
    });
  };

  const toggleRow = (idx: number) => {
    setVisibleRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (allVisible) {
      setAllVisible(false);
      setVisibleRows(new Set());
    } else {
      setAllVisible(true);
      setVisibleRows(new Set(pairs.map((_, i) => i)));
    }
  };

  const isVisible = (idx: number) => !secret || allVisible || visibleRows.has(idx);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = parseEnvFile(text);
      if (parsed.length > 0) {
        onChange([...pairs.filter((p) => p.key), ...parsed]);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-2">
      {secret && pairs.some((p) => p.key) && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={toggleAll}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {allVisible ? (
              <>
                <EyeOff className="h-3 w-3" />
                Hide all values
              </>
            ) : (
              <>
                <Eye className="h-3 w-3" />
                Show all values
              </>
            )}
          </button>
        </div>
      )}

      {pairs.map((pair, i) => (
        <div key={i} className="flex gap-2">
          <input
            type="text"
            value={pair.key}
            onChange={(e) => update(i, "key", e.target.value)}
            placeholder={keyPlaceholder}
            className="flex-1 min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
          />
          <div className="flex-[2] min-w-0 relative">
            <input
              type={isVisible(i) ? "text" : "password"}
              value={pair.value}
              onChange={(e) => update(i, "value", e.target.value)}
              placeholder={valuePlaceholder}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 pr-7 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-wxops-purple/50"
            />
            {secret && pair.value && (
              <button
                type="button"
                onClick={() => toggleRow(i)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {isVisible(i) ? (
                  <EyeOff className="h-3 w-3" />
                ) : (
                  <Eye className="h-3 w-3" />
                )}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={add}
          className="flex items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        >
          <Plus className="h-3 w-3" />
          Add
        </button>

        {allowImport && (
          <label className="flex items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-pointer">
            <Upload className="h-3 w-3" />
            Import .env
            <input
              type="file"
              accept=".env,.env.*,text/plain"
              onChange={handleImport}
              className="hidden"
            />
          </label>
        )}
      </div>
    </div>
  );
}

function parseEnvFile(text: string): KVPair[] {
  const pairs: KVPair[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    pairs.push({ key, value });
  }
  return pairs;
}
