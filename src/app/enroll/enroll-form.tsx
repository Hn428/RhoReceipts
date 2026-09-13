"use client";

import { useActionState } from "react";

import { importLedger, type ImportState } from "./actions";

const initialState: ImportState = { status: "idle" };

type Sample = { slug: string; name: string; description: string };

export function EnrollForm({
  samples,
  preselected,
}: {
  samples: Sample[];
  preselected?: string;
}) {
  const [state, formAction, pending] = useActionState(importLedger, initialState);
  const tokenError = state.status === "error" && state.field === "token" ? state.message : null;
  const formError = state.status === "error" && !state.field ? state.message : null;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {samples.length > 0 && (
        <fieldset className="flex flex-col gap-2.5" disabled={pending}>
          <legend className="mb-2.5 text-[0.72rem] font-medium uppercase tracking-[0.12em] text-ink-soft">
            Use a sample company
          </legend>
          {samples.map((sample) => (
            <button
              key={sample.slug}
              type="submit"
              name="sample"
              value={sample.slug}
              formNoValidate
              className={`group flex items-start justify-between gap-4 rounded-[3px] border px-4 py-3 text-left transition-colors hover:border-ink disabled:opacity-50 ${
                preselected === sample.slug ? "border-verified bg-verified-wash/60" : "border-rule-strong"
              }`}
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-ink">{sample.name}</span>
                <span className="text-xs leading-relaxed text-ink-soft">{sample.description}</span>
              </span>
              <span aria-hidden="true" className="pt-0.5 text-ink-faint group-hover:text-ink">
                →
              </span>
            </button>
          ))}
          <p className="text-xs text-ink-faint">
            Sample companies use the mock Rho environment — simulated ledgers, not real bank data.
          </p>
        </fieldset>
      )}

      <div className="flex items-center gap-3 text-xs text-ink-faint">
        <span className="h-px flex-1 bg-rule" />
        or connect with a token
        <span className="h-px flex-1 bg-rule" />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="token" className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-ink-soft">
          Rho access token
        </label>
        <input
          id="token"
          name="token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="rhobat_…"
          aria-invalid={tokenError ? true : undefined}
          aria-describedby={tokenError ? "token-error" : "token-hint"}
          disabled={pending}
          className="figures w-full rounded-[3px] border border-rule-strong bg-paper px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint focus-visible:border-verified disabled:opacity-60 aria-[invalid]:border-flagged"
        />
        {tokenError ? (
          <p id="token-error" role="alert" className="text-sm text-flagged">
            {tokenError}
          </p>
        ) : (
          <p id="token-hint" className="text-xs text-ink-faint">
            Read-only. Account owners and admins can create one in Rho&apos;s settings.
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded-[3px] bg-ink px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Importing transactions…" : "Connect and import"}
        </button>
      </div>

      {pending && (
        <p role="status" className="text-sm text-ink-soft">
          Reading accounts, transactions and invoices…
        </p>
      )}
      {formError && (
        <p role="alert" className="rounded-[3px] border border-flagged/40 bg-flagged-wash px-3 py-2 text-sm text-flagged">
          {formError}
        </p>
      )}
    </form>
  );
}
