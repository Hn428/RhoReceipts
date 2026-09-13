"use client";

import { usePathname } from "next/navigation";
import type { ViewRole } from "@/lib/view-role";

const founderDestinations = [
  { href: "/dashboard", label: "Founder dashboard" },
  { href: "/enroll", label: "Setup" },
  { href: "/mock-rho", label: "Bank demo" },
] as const;

const investorDestinations = [
  { href: "/investor", label: "Investor portfolio" },
] as const;

const sectionIsCurrent = (pathname: string, href: string) => {
  if (href === "/mock-rho") return pathname.startsWith("/mock-rho");
  return pathname === href || pathname.startsWith(`${href}/`);
};

/** Shared product navigation. Mock Rho keeps its own banking-app chrome. */
export function SiteNav({ role, hasCompany = false }: { role?: ViewRole; hasCompany?: boolean }) {
  const pathname = usePathname();
  if (pathname === "/" || pathname.startsWith("/mock-rho") || pathname.startsWith("/signin")) return null;

  const inferredRole = pathname.startsWith("/investor") ? "investor" : "founder";
  const destinations = (role ?? inferredRole) === "investor"
    ? investorDestinations
    : founderDestinations.filter(({ href }) => href !== "/enroll" || !hasCompany);

  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur-sm">
      <nav
        aria-label="Rho Receipts"
        className="mx-auto flex h-14 w-full max-w-7xl items-center gap-5 px-4 sm:px-6"
      >
        <span
          aria-label="Rho Receipts"
          className="shrink-0 cursor-default select-none text-xs font-semibold tracking-[0.12em] text-ink"
        >
          <span aria-hidden="true" className="sm:hidden">RR</span>
          <span aria-hidden="true" className="hidden sm:inline">RHO RECEIPTS</span>
        </span>
        <span aria-hidden="true" className="h-4 border-l border-rule-strong" />
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:gap-1">
          {destinations.map(({ href, label }) => (
            <a
              key={href}
              href={href}
              aria-current={sectionIsCurrent(pathname, href) ? "page" : undefined}
              className="shrink-0 rounded px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-sunken hover:text-ink aria-[current=page]:bg-ink aria-[current=page]:text-paper sm:text-[0.82rem]"
            >
              {label}
            </a>
          ))}
        </div>
      </nav>
    </header>
  );
}
