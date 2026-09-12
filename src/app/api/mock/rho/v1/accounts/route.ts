import { checkAuth, isResponse, json, paginate, sortBy } from "@/lib/rho/mock/http";
import { accounts } from "@/lib/rho/mock/store";

/** GET /accounts — https://docs.rho.co/api/v1/openapi/accounts/listaccounts */
export async function GET(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const params = new URL(req.url).searchParams;
  const sorted = sortBy(
    accounts,
    params.get("sort_by"),
    params.get("order"),
    {
      account_name: (a) => a.account_name ?? "",
      account_type: (a) => a.account_type,
      balance: (a) => a.balance.amount,
    },
    "account_name",
  );
  if (isResponse(sorted)) return sorted;

  const result = paginate(sorted, req);
  if (isResponse(result)) return result;
  return json({ accounts: result.page, page: result.envelope });
}
