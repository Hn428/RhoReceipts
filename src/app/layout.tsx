import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { SiteNav } from "./site-nav";
import { auth } from "@/auth";
import { connectionForOwner } from "@/lib/ingest/sync";
import { isViewRole, VIEW_ROLE_COOKIE } from "@/lib/view-role";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Rho Receipts",
  description:
    "Verified startup metrics derived from real bank transactions, traceable to the ledger.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const storedRole = (await cookies()).get(VIEW_ROLE_COOKIE)?.value;
  const role = isViewRole(storedRole) ? storedRole : undefined;
  const session = await auth();
  const hasCompany = role !== "investor" && session?.user?.id
    ? Boolean(await connectionForOwner(session.user.id))
    : false;
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        <SiteNav role={role} hasCompany={hasCompany} />
        {children}
      </body>
    </html>
  );
}
