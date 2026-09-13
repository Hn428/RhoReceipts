/**
 * Canonical hashing for change detection.
 *
 * JSON.stringify key order follows insertion order, which is not guaranteed
 * stable across API responses — so keys are sorted before hashing. Without
 * this, a reordered payload looks like a changed transaction and we would
 * record spurious versions.
 */

import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = canonicalize(source[key]);
    }
    return out;
  }
  return value;
}

export function contentHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}
