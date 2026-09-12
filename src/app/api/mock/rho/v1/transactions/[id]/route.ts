import { checkAuth, json, problem } from "@/lib/rho/mock/http";
import { transactions } from "@/lib/rho/mock/store";

/** GET /transactions/{id} */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  const txn = transactions.find((t) => t.id === id);
  if (!txn) return problem(404, "Not Found", `No transaction with id ${id}.`);
  return json(txn);
}
