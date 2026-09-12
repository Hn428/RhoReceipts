/**
 * Outbound mail.
 *
 * Development prints each message to the server console, the same approach
 * as sign-in links: the whole flow works with no provider credentials and
 * nothing leaves the machine. A real provider is a new transport here; callers
 * don't change.
 */

import "server-only";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailResult {
  transport: string;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  console.log(
    [
      "",
      "──────────────────────────────────────────────────────────────",
      `  To:      ${message.to}`,
      `  Subject: ${message.subject}`,
      "",
      ...message.text.split("\n").map((line) => `  ${line}`),
      "",
      "  Development only — no email was sent.",
      "──────────────────────────────────────────────────────────────",
      "",
    ].join("\n"),
  );
  return { transport: "console" };
}
