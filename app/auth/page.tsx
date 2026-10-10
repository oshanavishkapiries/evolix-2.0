"use client";

import { FormEvent, useState } from "react";

export default function AuthPage() {
  const [result, setResult] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>, endpoint: string, method: string) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const res = await fetch(`/api/auth/${endpoint}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "GET" ? undefined : JSON.stringify(data),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {}
    setResult(JSON.stringify({ status: res.status, body: parsed }, null, 2));
  }

  return (
    <main>
      <h1>Auth test page</h1>
      <h2>Last response</h2>
      <pre>{result}</pre>
      <form onSubmit={(e) => submit(e, "register", "POST")}>
        <h2>Register</h2>
        <label>
          email
          <input name="email" type="email" required />
        </label>
        <label>
          password
          <input name="password" type="password" required />
        </label>
        <button type="submit">Register</button>
      </form>
      <form onSubmit={(e) => submit(e, "verify-email", "POST")}>
        <h2>Verify email</h2>
        <label>
          email
          <input name="email" type="email" required />
        </label>
        <label>
          otp
          <input name="otp" type="text" required />
        </label>
        <button type="submit">Verify email</button>
      </form>
      <form onSubmit={(e) => submit(e, "resend-otp", "POST")}>
        <h2>Resend OTP</h2>
        <label>
          email
          <input name="email" type="email" required />
        </label>
        <label>
          purpose
          <select name="purpose">
            <option value="verify_email">verify_email</option>
            <option value="reset_password">reset_password</option>
          </select>
        </label>
        <button type="submit">Resend OTP</button>
      </form>
      <form onSubmit={(e) => submit(e, "login", "POST")}>
        <h2>Login</h2>
        <label>
          email
          <input name="email" type="email" required />
        </label>
        <label>
          password
          <input name="password" type="password" required />
        </label>
        <button type="submit">Login</button>
      </form>
      <form onSubmit={(e) => submit(e, "refresh", "POST")}>
        <h2>Refresh</h2>
        <button type="submit">Refresh</button>
      </form>
      <form onSubmit={(e) => submit(e, "me", "GET")}>
        <h2>Me</h2>
        <button type="submit">Me</button>
      </form>
      <form onSubmit={(e) => submit(e, "logout", "POST")}>
        <h2>Logout</h2>
        <button type="submit">Logout</button>
      </form>
      <form onSubmit={(e) => submit(e, "logout-all", "POST")}>
        <h2>Logout all devices</h2>
        <button type="submit">Logout all devices</button>
      </form>
      <form onSubmit={(e) => submit(e, "forgot-password", "POST")}>
        <h2>Forgot password</h2>
        <label>
          email
          <input name="email" type="email" required />
        </label>
        <button type="submit">Forgot password</button>
      </form>
      <form onSubmit={(e) => submit(e, "reset-password", "POST")}>
        <h2>Reset password</h2>
        <label>
          email
          <input name="email" type="email" required />
        </label>
        <label>
          otp
          <input name="otp" type="text" required />
        </label>
        <label>
          newPassword
          <input name="newPassword" type="password" required />
        </label>
        <button type="submit">Reset password</button>
      </form>
    </main>
  );
}
