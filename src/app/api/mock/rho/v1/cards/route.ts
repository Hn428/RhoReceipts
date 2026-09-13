import { authorize, isResponse, json, paginate } from "@/lib/rho/mock/http";
import { matchesAny } from "@/lib/rho/mock/store";

/** GET /cards — https://docs.rho.co/api/v1/openapi/cards/listcards */
export async function GET(req: Request) {
  const company = authorize(req);
  if (isResponse(company)) return company;

  const p = new URL(req.url).searchParams;
  const userIds = p.getAll("user_id");
  const types = p.getAll("type");
  const statuses = p.getAll("status");

  const filtered = company.cards.filter(
    (c) =>
      matchesAny(userIds, c.cardholder.user_id) &&
      matchesAny(types, c.type) &&
      matchesAny(statuses, c.status),
  );

  const result = paginate(filtered, req);
  if (isResponse(result)) return result;
  return json({ cards: result.page, page: result.envelope });
}
