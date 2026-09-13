export const VIEW_ROLE_COOKIE = "rho-receipts-view";

export type ViewRole = "founder" | "investor";

export function isViewRole(value: string | undefined): value is ViewRole {
  return value === "founder" || value === "investor";
}

export const viewRoleCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};
