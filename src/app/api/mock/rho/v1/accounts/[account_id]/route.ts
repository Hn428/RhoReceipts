import { authorize, isResponse, json, problem } from "@/lib/rho/mock/http";

/** GET /accounts/{account_id} */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ account_id: string }> },
) {
  const company = authorize(req);
  if (isResponse(company)) return company;

  const { account_id } = await ctx.params;
  const account = company.accounts.find((a) => a.id === account_id);
  if (!account) {
    return problem(404, "Not Found", `No account with id ${account_id}.`);
  }
  return json(account);
}
