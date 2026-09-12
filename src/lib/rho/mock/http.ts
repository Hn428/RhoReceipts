/**
 * Shared plumbing for the mock Rho API.
 *
 * Fidelity matters more than convenience here: the mock enforces bearer auth,
 * RFC 7807 error bodies, page_size bounds, and cursor-to-filter binding exactly
 * as documented. A client that works against this one works against the real
 * API — and bugs in our pagination handling surface in development rather than
 * against a live token.
 */

import type { RhoPage, RhoProblem } from "../types";

/** Dev token. Overridable so nothing real is ever hard-coded. */
export const MOCK_TOKEN =
  process.env.RHO_MOCK_TOKEN ?? "rhobat_mock_northstar_labs_dev_token";

const PROBLEM_BASE = "https://docs.rho.co/problems";

export function problem(
  status: number,
  title: string,
  detail?: string,
): Response {
  const body: RhoProblem = {
    type: `${PROBLEM_BASE}/${title.toLowerCase().replace(/\s+/g, "-")}`,
    title,
    status,
    ...(detail ? { detail } : {}),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

export function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Returns a 401/403 response when the request is not properly authorized. */
export function checkAuth(req: Request): Response | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return problem(
      401,
      "Unauthorized",
      "Missing bearer token. Send Authorization: Bearer rhobat_...",
    );
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token.startsWith("rhobat_")) {
    return problem(401, "Unauthorized", "Malformed access token.");
  }
  if (token !== MOCK_TOKEN) {
    return problem(401, "Unauthorized", "Unknown or revoked access token.");
  }
  return null;
}

// ------------------------------------------------------------------- cursors

/**
 * Cursors are opaque and bound to the endpoint plus its filters, mirroring the
 * documented contract: reusing a token with different filters is a 400, not a
 * silently wrong page.
 */
function fingerprint(path: string, params: URLSearchParams): string {
  const pairs: string[] = [];
  for (const [k, v] of params) {
    if (k === "page_token" || k === "page_size") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const input = `${path}?${pairs.join("&")}`;
  // djb2 — not security, just change detection.
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function encodeCursor(offset: number, fp: string): string {
  return Buffer.from(JSON.stringify({ o: offset, f: fp }), "utf8").toString(
    "base64url",
  );
}

function decodeCursor(
  token: string,
): { offset: number; fingerprint: string } | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8"),
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { o?: unknown }).o !== "number" ||
      typeof (parsed as { f?: unknown }).f !== "string"
    ) {
      return null;
    }
    const c = parsed as { o: number; f: string };
    return { offset: c.o, fingerprint: c.f };
  } catch {
    return null;
  }
}

export interface PaginateOptions {
  defaultPageSize?: number;
  maxPageSize?: number;
}

/**
 * Slices an already-filtered, already-sorted list into a documented page
 * envelope, or returns a problem response for a bad cursor / page size.
 */
export function paginate<T>(
  items: T[],
  req: Request,
  opts: PaginateOptions = {},
): { page: T[]; envelope: RhoPage } | Response {
  const url = new URL(req.url);
  const params = url.searchParams;
  const max = opts.maxPageSize ?? 100;
  const fallback = opts.defaultPageSize ?? 20;

  const rawSize = params.get("page_size");
  let pageSize = fallback;
  if (rawSize !== null) {
    const n = Number(rawSize);
    if (!Number.isInteger(n) || n < 1 || n > max) {
      return problem(
        400,
        "Bad Request",
        `page_size must be an integer between 1 and ${max}.`,
      );
    }
    pageSize = n;
  }

  const fp = fingerprint(url.pathname, params);
  let offset = 0;
  const rawToken = params.get("page_token");
  if (rawToken) {
    const cursor = decodeCursor(rawToken);
    if (!cursor) {
      return problem(400, "Bad Request", "Malformed page_token.");
    }
    if (cursor.fingerprint !== fp) {
      return problem(
        400,
        "Bad Request",
        "page_token was issued for a different endpoint, filter set, or sort order.",
      );
    }
    offset = cursor.offset;
  }

  const slice = items.slice(offset, offset + pageSize);
  const next = offset + pageSize;
  return {
    page: slice,
    envelope: {
      next_page_token: next < items.length ? encodeCursor(next, fp) : null,
    },
  };
}

export function isResponse(v: unknown): v is Response {
  return v instanceof Response;
}

/** Generic sort helper shared by the list endpoints. */
export function sortBy<T>(
  items: T[],
  field: string | null,
  order: string | null,
  accessors: Record<string, (item: T) => string | number>,
  fallbackField: string,
): T[] | Response {
  const key = field ?? fallbackField;
  const accessor = accessors[key];
  if (!accessor) {
    return problem(
      400,
      "Bad Request",
      `sort_by must be one of: ${Object.keys(accessors).join(", ")}.`,
    );
  }
  if (order && order !== "asc" && order !== "desc") {
    return problem(400, "Bad Request", "order must be 'asc' or 'desc'.");
  }
  const dir = order === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  });
}
