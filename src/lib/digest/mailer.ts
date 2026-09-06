import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { RenderedEmail } from "./email";

/**
 * Sending, if it is configured at all.
 *
 * Email is optional and off by default: the digest's real home is the teacher
 * area, and SMTP is a convenience on top. A failure to send is logged and
 * reported, never thrown into the caller's face — the digest is already stored
 * by the time this runs.
 */

export interface Mailer {
  send(email: RenderedEmail): Promise<void>;
}

export function isMailConfigured(): boolean {
  return Boolean(env().SMTP_URL && env().DIGEST_EMAIL_TO);
}

class SmtpMailer implements Mailer {
  constructor(
    private readonly url: string,
    private readonly to: string,
    private readonly from: string,
  ) {}

  async send(email: RenderedEmail): Promise<void> {
    // Imported here so nodemailer stays out of the bundle unless mail is used.
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport(this.url);
    try {
      await transport.sendMail({
        from: this.from,
        to: this.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    } finally {
      transport.close();
    }
  }
}

export function getMailer(): Mailer | null {
  const { SMTP_URL, DIGEST_EMAIL_TO, DIGEST_EMAIL_FROM } = env();
  if (!SMTP_URL || !DIGEST_EMAIL_TO) return null;
  return new SmtpMailer(SMTP_URL, DIGEST_EMAIL_TO, DIGEST_EMAIL_FROM ?? DIGEST_EMAIL_TO);
}

export async function trySend(mailer: Mailer | null, email: RenderedEmail): Promise<boolean> {
  if (!mailer) return false;
  try {
    await mailer.send(email);
    return true;
  } catch (error) {
    logger.error({ err: error }, "sending the digest failed");
    return false;
  }
}
