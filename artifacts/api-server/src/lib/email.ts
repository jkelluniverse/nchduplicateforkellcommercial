import { google } from "googleapis";
import { logger } from "./logger";

function buildCredentials(): { client_email: string; private_key: string } {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error("Google credentials not configured");
  let privateKey = rawKey;
  const jsonMatch = rawKey.match(/"private_key"\s*:\s*"([\s\S]+?)(?<!\\)"\s*[,}]?/);
  if (jsonMatch) privateKey = jsonMatch[1];
  privateKey = privateKey.replace(/\\n/g, "\n").trim();
  return { client_email: email, private_key: privateKey };
}

function base64url(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderFieldsHtml(fields: Array<[string, string | null | undefined]>): string {
  const rows = fields
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 12px;border:1px solid #eee;font-weight:bold;background:#faf5f5;">${escapeHtml(
          k,
        )}</td><td style="padding:6px 12px;border:1px solid #eee;">${escapeHtml(String(v))}</td></tr>`,
    )
    .join("");
  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">${rows}</table>`;
}

/**
 * Send an email via the Gmail API using domain-wide-delegation impersonation.
 * Requires GOOGLE_IMPERSONATE_USER to be set (the sender's Workspace email).
 * Returns true on success, false on any failure (non-throwing).
 */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  try {
    const impersonate = process.env.GOOGLE_IMPERSONATE_USER;
    if (!impersonate) {
      logger.warn({ to: opts.to }, "sendEmail skipped: GOOGLE_IMPERSONATE_USER not set");
      return false;
    }
    const creds = buildCredentials();
    const auth = new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ["https://www.googleapis.com/auth/gmail.send"],
      subject: impersonate,
    });
    const gmail = google.gmail({ version: "v1", auth: auth as never });

    const message = [
      `From: Nice City Homes <${impersonate}>`,
      `To: ${opts.to}`,
      `Subject: ${opts.subject}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      opts.html,
    ].join("\r\n");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: base64url(message) },
    });
    logger.info({ to: opts.to, subject: opts.subject }, "Email sent");
    return true;
  } catch (err: any) {
    logger.error(
      { to: opts.to, subject: opts.subject, err: String(err?.message ?? err) },
      "Email send failed",
    );
    return false;
  }
}
