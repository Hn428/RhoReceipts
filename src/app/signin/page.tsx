import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { auth, signIn } from "@/auth";
import { VIEW_ROLE_COOKIE, viewRoleCookieOptions } from "@/lib/view-role";

export const metadata = { title: "Sign in · Rho Receipts" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}) {
  const requestedDestination = (await searchParams).callbackUrl;
  const destination = requestedDestination === "/investor" ? "/investor" : "/dashboard";
  const isInvestor = destination === "/investor";
  const session = await auth();
  if (session?.user) redirect(destination);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">Rho Receipts</p>
        <h1 className="font-display text-4xl leading-[1.08]">
          {isInvestor ? "Open your shared receipts" : "Metrics your investors can audit"}
        </h1>
        <p className="text-sm leading-relaxed text-ink-soft">
          {isInvestor
            ? "Use the email address a founder shared a receipt with or added to monthly delivery. You will see only receipts sent to that address."
            : "Revenue, burn and runway computed from your bank ledger, with every figure traceable to the transactions behind it. Sign in with your email — no password."}
        </p>
      </div>

      <form
        className="perforated flex flex-col gap-4 rounded-[2px] bg-paper px-6 py-8 shadow-[0_1px_0_var(--rule),0_12px_32px_-18px_rgb(0_0_0/0.25)]"
        action={async (formData: FormData) => {
          "use server";
          (await cookies()).set(
            VIEW_ROLE_COOKIE,
            isInvestor ? "investor" : "founder",
            viewRoleCookieOptions,
          );
          await signIn("email", {
            email: String(formData.get("email") ?? ""),
            redirectTo: destination,
          });
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-ink-soft">
            Work email
          </span>
          <input
            type="email"
            name="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className="rounded-[3px] border border-rule-strong bg-paper px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:border-verified"
          />
        </label>
        <button
          type="submit"
          className="rounded-[3px] bg-ink px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          Email me a sign-in link
        </button>
      </form>
    </main>
  );
}
