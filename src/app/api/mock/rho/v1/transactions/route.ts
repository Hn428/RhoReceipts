import { authorize, isResponse, json, paginate, sortBy } from "@/lib/rho/mock/http";
import { matchesAny, withinRange } from "@/lib/rho/mock/store";

/** GET /transactions — https://docs.rho.co/api/v1/openapi/transactions/listtransactions */
export async function GET(req: Request) {
  const company = authorize(req);
  if (isResponse(company)) return company;

  const p = new URL(req.url).searchParams;
  const accountIds = p.getAll("account_id");
  const accountTypes = p.getAll("account_type");
  const types = p.getAll("transaction_type");
  const statuses = p.getAll("status");
  const userIds = p.getAll("user_id");
  const cardIds = p.getAll("card_id");
  const search = p.get("search")?.toLowerCase() ?? null;
  const minAmount = p.get("min_amount");
  const maxAmount = p.get("max_amount");

  const filtered = company.transactions.filter((t) => {
    if (!matchesAny(accountIds, t.account_id)) return false;
    if (!matchesAny(accountTypes, t.account_type)) return false;
    if (!matchesAny(types, t.transaction_type)) return false;
    if (!matchesAny(statuses, t.status)) return false;
    if (!matchesAny(userIds, t.user_id)) return false;
    if (!matchesAny(cardIds, t.card_id)) return false;

    if (
      !withinRange(
        t.initiated_at,
        p.get("initiated_after"),
        p.get("initiated_before"),
      )
    ) {
      return false;
    }
    // Pending rows have no posted_at, so a posted_* filter excludes them.
    if (p.get("posted_after") || p.get("posted_before")) {
      if (!withinRange(t.posted_at, p.get("posted_after"), p.get("posted_before"))) {
        return false;
      }
    }

    if (minAmount !== null && t.amount.amount < Number(minAmount)) return false;
    if (maxAmount !== null && t.amount.amount > Number(maxAmount)) return false;

    if (search) {
      const haystack = [t.counterparty_name, t.memo, t.note]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const sorted = sortBy(
    filtered,
    p.get("sort_by"),
    p.get("order"),
    {
      initiated_at: (t) => t.initiated_at,
      posted_at: (t) => t.posted_at ?? "",
      amount: (t) => t.amount.amount,
      counterparty_name: (t) => t.counterparty_name,
    },
    "initiated_at",
  );
  if (isResponse(sorted)) return sorted;

  const result = paginate(sorted, req);
  if (isResponse(result)) return result;
  return json({ transactions: result.page, page: result.envelope });
}
