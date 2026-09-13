import { NextResponse } from "next/server";

import { isViewRole, VIEW_ROLE_COOKIE, viewRoleCookieOptions } from "@/lib/view-role";

export async function GET(request: Request, { params }: RouteContext<"/auth/view/[role]">) {
  const { role } = await params;
  const selectedRole = isViewRole(role) ? role : "founder";
  const destination = selectedRole === "investor" ? "/investor" : "/dashboard";
  const response = NextResponse.redirect(new URL(destination, request.url));
  response.cookies.set(VIEW_ROLE_COOKIE, selectedRole, viewRoleCookieOptions);
  return response;
}
