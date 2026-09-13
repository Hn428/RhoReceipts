"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The receipt's link with a copy button. The link stays visible and selectable,
 * so it can still be copied by hand where the clipboard API is unavailable.
 */
export function CopyLink({ url }: { url: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      input.current?.select();
      setState("manual");
    }
  }

  return (
    <div className="flex w-full flex-col gap-1.5 sm:max-w-md">
      <div className="flex gap-2">
        <input
          ref={input}
          readOnly
          value={url}
          aria-label="Receipt link"
          onFocus={(event) => event.currentTarget.select()}
          className="figures min-w-0 flex-1 rounded border border-rule-strong bg-paper px-3 py-2 text-xs text-ink-soft"
        />
        <button
          type="button"
          onClick={copy}
          className="w-[6.5rem] shrink-0 rounded border border-rule-strong bg-paper px-3 py-2 text-sm font-semibold text-ink hover:bg-paper/60"
        >
          {state === "copied" ? "Copied" : "Copy link"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-ink-faint empty:hidden">
        {state === "manual" ? "Couldn't copy automatically. The link is selected — copy it with ⌘C or Ctrl+C." : ""}
      </p>
    </div>
  );
}
