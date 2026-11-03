import nodemailer, { type Transporter } from "nodemailer";
import { getConfig } from "@/lib/config";

let transporter: Transporter | undefined;
let transportSettings: string | undefined;

export async function getTransporter() {
  const config = await getConfig();
  const settings = JSON.stringify([config.SMTP_HOST, config.SMTP_PORT, config.SMTP_USER, config.SMTP_PASS]);
  if (!transporter || transportSettings !== settings) {
    transporter?.close();
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
      requireTLS: true,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    });
    transportSettings = settings;
  }
  return transporter;
}

export async function sendOtpEmail(
  to: string,
  code: string,
  purpose: "verify_email" | "reset_password",
) {
  const minutes = Math.ceil((await getConfig()).OTP_TTL_SECONDS / 60);
  const subject =
    purpose === "verify_email" ? "Verify your email" : "Reset your password";
  const text = `Your code is ${code}. It is valid for ${minutes} minutes.\nIf you did not request this, ignore this email.`;
  const html = `<p>Your code is <strong>${code}</strong>.</p><p>It is valid for ${minutes} minutes.</p><p>If you did not request this, ignore this email.</p>`;
  await (await getTransporter()).sendMail({ from: (await getConfig()).SMTP_FROM, to, subject, text, html });
}
