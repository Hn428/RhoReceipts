import { checkAuth, isResponse, json, paginate, sortBy } from "@/lib/rho/mock/http";
import { customers } from "@/lib/rho/mock/store";

/** GET /invoicing/customers */
export async function GET(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const p = new URL(req.url).searchParams;
  const search = p.get("search")?.toLowerCase() ?? null;
  const includeDeleted = p.get("include_deleted") === "true";

  const filtered = customers.filter((c) => {
    if (!includeDeleted && c.deleted_at) return false;
    if (!search) return true;
    return (
      c.legal_name.toLowerCase().includes(search) ||
      c.email.toLowerCase().includes(search)
    );
  });

  const sorted = sortBy(
    filtered,
    p.get("sort_by"),
    p.get("order"),
    {
      created_at: (c) => c.created_at,
      updated_at: (c) => c.updated_at,
      legal_name: (c) => c.legal_name,
      total_revenue: (c) => c.total_revenue.amount,
    },
    "created_at",
  );
  if (isResponse(sorted)) return sorted;

  const result = paginate(sorted, req);
  if (isResponse(result)) return result;
  return json({ customers: result.page, page: result.envelope });
}
