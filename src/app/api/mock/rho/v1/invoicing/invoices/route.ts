import { checkAuth, isResponse, json, paginate } from "@/lib/rho/mock/http";
import { invoices, matchesAny, withinRange } from "@/lib/rho/mock/store";

/** GET /invoicing/invoices */
export async function GET(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const p = new URL(req.url).searchParams;
  const statuses = p.getAll("status");

  const filtered = invoices.filter((inv) => {
    if (!matchesAny(statuses, inv.status)) return false;
    if (!withinRange(inv.date, p.get("date_after"), p.get("date_before"))) {
      return false;
    }
    if (
      !withinRange(inv.due_date, p.get("due_date_after"), p.get("due_date_before"))
    ) {
      return false;
    }
    return true;
  });

  const result = paginate(filtered, req);
  if (isResponse(result)) return result;
  return json({ invoices: result.page, page: result.envelope });
}
