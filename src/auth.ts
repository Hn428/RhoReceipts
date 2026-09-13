/**
 * Authentication — Auth.js v5, passwordless email sign-in.
 *
 * No passwords are stored, which removes a whole class of breach from a product
 * whose entire premise is that a founder trusts it with bank data.
 *
 * In development the magic link is printed to the server console rather than
 * emailed, so sign-in works with no SMTP credentials and nothing leaves the
 * machine. Point `AUTH_EMAIL_FROM` at a real transport before shipping.
 */

import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { EmailConfig } from "next-auth/providers";

import { getDb } from "@/lib/db";
import {
  authAccounts,
  sessions,
  users,
  verificationTokens,
} from "@/lib/db/schema";

/**
 * A provider that delivers the sign-in link to the terminal.
 *
 * Defined inline rather than via the Nodemailer provider so the app carries no
 * mail dependency until it actually needs to send mail.
 */
const consoleEmailProvider: EmailConfig = {
  id: "email",
  type: "email",
  name: "Email",
  from: process.env.AUTH_EMAIL_FROM ?? "no-reply@rho-receipts.local",
  maxAge: 15 * 60,
  options: {},
  async sendVerificationRequest({ identifier, url }) {
    console.log(
      [
        "",
        "──────────────────────────────────────────────────────────────",
        `  Sign-in link for ${identifier}`,
        "",
        `  ${url}`,
        "",
        "  Expires in 15 minutes. Development only — no email was sent.",
        "──────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  },
};

/**
 * Config is a function so the database is opened on the first auth call, not
 * when this module is imported.
 *
 * `next build` imports every route in parallel workers to collect page data.
 * An eager `getDb()` here meant each worker opened the same single-writer
 * PGlite directory at once, and the losers aborted inside WASM. Nothing needs
 * the database at build time — every page that calls `auth()` is dynamic.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: authAccounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [consoleEmailProvider],
  session: { strategy: "database" },
  pages: { signIn: "/signin", verifyRequest: "/signin/sent" },
  callbacks: {
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
}));
