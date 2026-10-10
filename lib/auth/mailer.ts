import nodemailer from "nodemailer";
import { env } from "@/lib/env";

let transporter: nodemailer.Transporter | undefined;

export function getTransporter() {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    requireTLS: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

export async function sendOtpEmail(
  to: string,
  code: string,
  purpose: "verify_email" | "reset_password",
) {
  const minutes = Math.ceil(env.OTP_TTL_SECONDS / 60);
  const subject =
    purpose === "verify_email" ? "Verify your email" : "Reset your password";
  const text = `Your code is ${code}. It is valid for ${minutes} minutes.\nIf you did not request this, ignore this email.`;
  const html = `<p>Your code is <strong>${code}</strong>.</p><p>It is valid for ${minutes} minutes.</p><p>If you did not request this, ignore this email.</p>`;
  await getTransporter().sendMail({ from: env.SMTP_FROM, to, subject, text, html });
}
