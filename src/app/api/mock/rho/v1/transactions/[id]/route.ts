import { authorize, isResponse, json, problem } from "@/lib/rho/mock/http";

/** GET /transactions/{id} */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const company = authorize(req);
  if (isResponse(company)) return company;

  const { id } = await ctx.params;
  const txn = company.transactions.find((t) => t.id === id);
  if (!txn) return problem(404, "Not Found", `No transaction with id ${id}.`);
  return json(txn);
}
