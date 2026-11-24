import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { getDb } from "@/db/client";
import { resolveMailConfig, type MailConfig } from "@/lib/mail-settings";

/**
 * Outgoing email (one-time codes). Plain SMTP through nodemailer, so any provider works: Gmail (app password), Outlook /
 * Microsoft 365, AWS SES. The connection is chosen by an admin under Admin > Settings > Email (saved in the
 * database, password encrypted); nothing is read from environment variables.
 *
 * With no active connection: outside production the message is printed to the server console (local development) and
 * kept in `outbox` (tests read the code from there); in production sending fails loudly instead of dropping the email.
 */
export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Inline images referenced from `html` as `cid:<cid>`. Not logged or captured. */
  attachments?: { filename: string; path: string; cid: string }[];
}

export const outbox: Mail[] = [];

const transports = new Map<string, nodemailer.Transporter>();

function transportFor(c: MailConfig): nodemailer.Transporter {
  // keyed by a hash of every setting, so saving new settings in the admin page takes effect on the very next email
  const k = crypto.createHash("sha256").update(JSON.stringify([c.host, c.port, c.secure, c.requireTLS, c.user, c.pass])).digest("hex");
  let t = transports.get(k);
  if (!t) {
    transports.clear(); // only the current settings are kept
    t = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      requireTLS: c.requireTLS,
      auth: c.user ? { user: c.user, pass: c.pass ?? "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    transports.set(k, t);
  }
  return t;
}

/** Vitest never reads the database for settings: a developer's saved SMTP login must not send mail from unit tests. */
const settingsDb = async () => (process.env.VITEST ? null : await getDb());

export const mailFrom = (c: MailConfig) => c.from || "Knowledge Review <no-reply@localhost>";

export async function sendMail(mail: Mail): Promise<void> {
  const cfg = await resolveMailConfig(await settingsDb());
  if (cfg.source === "none") {
    // TEST ONLY: the e2e run (a production build with no SMTP) reads codes from this file. Never set it on a real server.
    if (process.env.MAIL_CAPTURE_FILE) {
      fs.mkdirSync(path.dirname(process.env.MAIL_CAPTURE_FILE), { recursive: true });
      fs.appendFileSync(process.env.MAIL_CAPTURE_FILE, `${JSON.stringify({ to: mail.to, subject: mail.subject, text: mail.text, html: mail.html })}\n`);
      return;
    }
    if (process.env.NODE_ENV === "production") throw new Error("Email is not configured: an admin must set it up under Admin > Settings > Email.");
    outbox.push(mail);
    if (outbox.length > 50) outbox.shift();
    console.log(`\n[mail:dev] To: ${mail.to}\n[mail:dev] Subject: ${mail.subject}\n${mail.text}\n`);
    return;
  }
  if (cfg.passwordUnreadable) throw new Error("The saved email password can no longer be read (the server secret changed). Enter it again under Admin > Settings > Email.");
  await transportFor(cfg).sendMail({ from: mailFrom(cfg), to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments });
}

/** Sends through exactly these settings (the admin "test" button), never the console fallback. Throws on any failure. */
export async function sendMailWith(cfg: MailConfig, mail: Mail): Promise<void> {
  if (cfg.source === "none") throw new Error("No email settings are saved yet.");
  if (cfg.passwordUnreadable) throw new Error("The saved password can no longer be read. Enter it again and save.");
  await transportFor(cfg).sendMail({ from: mailFrom(cfg), to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, attachments: mail.attachments });
}

/** A short, plain explanation of an SMTP failure for the admin. The raw server message is appended for support. */
export function describeMailError(e: unknown): string {
  const err = e as { code?: string; responseCode?: number; message?: string } | null;
  const raw = (err?.message ?? String(e)).replace(/\s+/g, " ").slice(0, 220);
  const code = err?.code;
  const rc = err?.responseCode;
  let why: string;
  if (/5\.7\.139|basic authentication is disabled/i.test(raw)) why = "Microsoft is refusing password sign-in for this mailbox. Ask your Microsoft 365 admin to enable Authenticated SMTP for it and to make sure Security Defaults / Conditional Access does not block basic authentication. Personal Outlook.com / Hotmail accounts cannot be used at all.";
  else if (/5\.7\.57|SmtpClientAuthentication is disabled|not authenticated to send mail/i.test(raw)) why = "Authenticated SMTP is switched off for this mailbox (or for the whole organisation). Ask your Microsoft 365 admin to enable it for the sending mailbox.";
  else if (code === "EAUTH" || rc === 535 || rc === 534 || rc === 530) why = "The mail server rejected the username or password. Gmail needs an app password (2-step verification must be on); Microsoft 365 needs Authenticated SMTP enabled for the mailbox.";
  else if (code === "EDNS" || code === "ENOTFOUND") why = "The host name was not found. Check the spelling of the host.";
  else if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "ESOCKET") why = "Could not connect to the server. Check the host and port, and that this server may connect out on that port.";
  else if (code === "ETLS" || /wrong version number|ssl|tls/i.test(raw)) why = "The secure connection failed. Port 587 uses STARTTLS and port 465 uses SSL/TLS: make sure Security matches the port.";
  else if (code === "EENVELOPE" || rc === 550 || rc === 553 || rc === 554) why = "The server refused the sender or recipient address. The sender must usually be the same mailbox you log in with.";
  else why = "Sending failed.";
  return `${why} (${raw})`;
}

export type OtpPurpose = "verify_email" | "change_password" | "reset_password" | "login";

export const OTP_MINUTES = 10;

const COPY: Record<OtpPurpose, { title: string; lead: string }> = {
  verify_email: { title: "Verify your email", lead: "Use this code to confirm this email address on your Knowledge Review account." },
  change_password: { title: "Change your password", lead: "Use this code to change your Knowledge Review password." },
  reset_password: { title: "Reset your password", lead: "Use this code to reset your Knowledge Review password." },
  login: { title: "Sign in", lead: "Use this code to sign in to Knowledge Review." },
};

const BRAND = { blue: "#2f6db5", ink: "#1f2937", muted: "#6b7280", line: "#e5e7eb", bg: "#f3f5f9", codeBg: "#eef3fb", codeLine: "#cdd9ee" };

/** ForceIntellect logo, attached inline (cid) so it shows without loading remote images and works on a private network. */
function logoAttachment() {
  const file = path.join(process.cwd(), "public", "force-logo.png");
  return fs.existsSync(file) ? [{ filename: "force-logo.png", path: file, cid: "force-logo" }] : undefined;
}

export function renderOtpMail(code: string, purpose: OtpPurpose, withLogo = true): { subject: string; text: string; html: string } {
  const { title, lead } = COPY[purpose];
  return renderCodeMail(
    {
      title,
      lead,
      code,
      subject: `${code} is your Knowledge Review code`,
      preheader: `Your Knowledge Review code is ${code}. It expires in ${OTP_MINUTES} minutes.`,
      note: `This code expires in ${OTP_MINUTES} minutes and can be used once.`,
      safe: "If you did not request it, you can ignore this email: nothing changes unless the code is used. Never share this code with anyone.",
    },
    withLogo,
  );
}

/** The message behind the admin "Send test email" button: same design, no real code. */
export function renderTestMail(withLogo = true): { subject: string; text: string; html: string } {
  return renderCodeMail(
    {
      title: "Email settings work",
      lead: "This is a test message from Knowledge Review. Sign-in and password codes will be delivered the same way.",
      code: "OK",
      codeLabel: "Status",
      subject: "Knowledge Review: test email",
      preheader: "Your Knowledge Review email settings are working.",
      note: "Nothing to do: you can delete this message.",
      safe: "You are receiving this because an administrator pressed Send test email.",
    },
    withLogo,
  );
}

interface CodeMail {
  title: string;
  lead: string;
  code: string;
  codeLabel?: string;
  subject: string;
  preheader: string;
  note: string;
  safe: string;
}

function renderCodeMail(p: CodeMail, withLogo: boolean): { subject: string; text: string; html: string } {
  const { title, lead, code, subject, preheader, note, safe, codeLabel = "Your code" } = p;
  const digits = code; // spacing comes from CSS letter-spacing only, so copy-paste gives exactly the 6 digits
  const logo = withLogo
    ? `<a href="https://forceintellect.com/" style="text-decoration:none"><img src="cid:force-logo" width="176" height="39" alt="ForceIntellect" style="display:block;border:0;outline:none;height:auto"></a>`
    : `<span style="font-size:20px;font-weight:700;color:${BRAND.blue}">ForceIntellect</span>`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${title}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <tr><td style="padding:28px 32px 20px;border-bottom:1px solid ${BRAND.line}">${logo}</td></tr>
    <tr><td style="padding:28px 32px 8px">
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:${BRAND.blue}">Knowledge Review</p>
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${BRAND.ink}">${title}</h1>
      <p style="margin:0;font-size:15px;line-height:1.6;color:${BRAND.ink}">${lead}</p>
    </td></tr>
    <tr><td align="center" style="padding:20px 32px">
      <div style="background:${BRAND.codeBg};border:1px solid ${BRAND.codeLine};border-radius:10px;padding:18px 12px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:${BRAND.ink};text-align:center">${digits}</div>
      <p style="margin:12px 0 0;font-size:13px;color:${BRAND.muted}">${note}</p>
    </td></tr>
    <tr><td style="padding:4px 32px 28px"><p style="margin:0;font-size:13px;line-height:1.6;color:${BRAND.muted}">${safe}</p></td></tr>
    <tr><td style="padding:16px 32px;background:#fafbfc;border-top:1px solid ${BRAND.line};font-size:12px;line-height:1.5;color:${BRAND.muted}">
      Sent by Knowledge Review &middot; <a href="https://forceintellect.com/" style="color:${BRAND.muted}">ForceIntellect</a><br>This is an automated message, please do not reply.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
  const text = `Knowledge Review - ${title}\n\n${lead}\n\n${codeLabel}: ${code}\n\n${note}\n${safe}\n\n-- Knowledge Review, ForceIntellect (automated message, please do not reply)`;
  return { subject, text, html };
}

export async function sendOtpMail(to: string, code: string, purpose: OtpPurpose): Promise<void> {
  const attachments = logoAttachment();
  const { subject, text, html } = renderOtpMail(code, purpose, !!attachments);
  await sendMail({ to, subject, text, html, attachments });
}

/** Sends the test message through the given settings and returns once the server accepted it. */
export async function sendTestMail(cfg: MailConfig, to: string): Promise<void> {
  const attachments = logoAttachment();
  const { subject, text, html } = renderTestMail(!!attachments);
  await sendMailWith(cfg, { to, subject, text, html, attachments });
}
