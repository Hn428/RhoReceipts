import { checkAuth, isResponse, json, paginate } from "@/lib/rho/mock/http";
import { cards, matchesAny } from "@/lib/rho/mock/store";

/** GET /cards — https://docs.rho.co/api/v1/openapi/cards/listcards */
export async function GET(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const p = new URL(req.url).searchParams;
  const userIds = p.getAll("user_id");
  const types = p.getAll("type");
  const statuses = p.getAll("status");

  const filtered = cards.filter(
    (c) =>
      matchesAny(userIds, c.cardholder.user_id) &&
      matchesAny(types, c.type) &&
      matchesAny(statuses, c.status),
  );

  const result = paginate(filtered, req);
  if (isResponse(result)) return result;
  return json({ cards: result.page, page: result.envelope });
}
