"use client";

import { useActionState } from "react";

import { connectRhoAccount, type ConnectState } from "./actions";

const initialState: ConnectState = { status: "idle" };

export function ConnectForm({ sampleAvailable }: { sampleAvailable: boolean }) {
  const [state, formAction, pending] = useActionState(
    connectRhoAccount,
    initialState,
  );
  const tokenError =
    state.status === "error" && state.field === "token" ? state.message : null;
  const formError =
    state.status === "error" && !state.field ? state.message : null;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label
          htmlFor="token"
          className="text-[0.72rem] font-medium uppercase tracking-[0.12em] text-ink-soft"
        >
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
            Account owners and admins can create one in Rho&apos;s settings.
            It&apos;s shown only once.
          </p>
        )}
      </div>

      <button
        type="submit"
        name="mode"
        value="token"
        disabled={pending}
        className="rounded-[3px] bg-ink px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Importing transactions…" : "Connect and generate receipt"}
      </button>

      {sampleAvailable && (
        <>
          <div className="flex items-center gap-3 text-xs text-ink-faint">
            <span className="h-px flex-1 bg-rule" />
            or
            <span className="h-px flex-1 bg-rule" />
          </div>
          <button
            type="submit"
            name="mode"
            value="demo"
            formNoValidate
            disabled={pending}
            className="rounded-[3px] border border-rule-strong px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-sunken disabled:opacity-50"
          >
            Use the sample company
          </button>
        </>
      )}

      {formError && (
        <p
          role="alert"
          className="rounded-[3px] border border-flagged/40 bg-flagged-wash px-3 py-2 text-sm text-flagged"
        >
          {formError}
        </p>
      )}
    </form>
  );
}
