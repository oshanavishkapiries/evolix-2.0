import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  return (
    <main>
      <h1>Register</h1>
      <RegisterForm />
      <p>
        <a href="/login">Already have an account? Log in</a>
      </p>
    </main>
  );
}
