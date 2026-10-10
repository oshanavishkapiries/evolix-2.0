import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <main className="auth card">
      <h1>Register</h1>
      <RegisterForm />
      <p className="text-sm">
        <a href="/login">Already have an account? Log in</a>
      </p>
    </main>
  );
}
