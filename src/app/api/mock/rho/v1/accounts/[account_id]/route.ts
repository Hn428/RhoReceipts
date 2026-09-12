import { checkAuth, json, problem } from "@/lib/rho/mock/http";
import { accounts } from "@/lib/rho/mock/store";

/** GET /accounts/{account_id} */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ account_id: string }> },
) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const { account_id } = await ctx.params;
  const account = accounts.find((a) => a.id === account_id);
  if (!account) {
    return problem(404, "Not Found", `No account with id ${account_id}.`);
  }
  return json(account);
}
