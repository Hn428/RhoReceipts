export const metadata = { title: "Check your email · Rho Receipts" };

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-6 py-16">
      <p className="text-[0.72rem] uppercase tracking-[0.14em] text-ink-faint">Rho Receipts</p>
      <h1 className="font-display text-4xl">Check your email</h1>
      <p className="text-sm leading-relaxed text-ink-soft">
        We sent you a sign-in link. It expires in 15 minutes.
      </p>
      <p className="rounded-[2px] border border-dashed border-rule-strong px-3 py-2 text-xs leading-relaxed text-ink-soft">
        Running locally? No email was sent — the link is printed in the terminal running{" "}
        <code className="figures">npm run dev</code>.
      </p>
    </main>
  );
}
