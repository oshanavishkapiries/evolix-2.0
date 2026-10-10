import { AuthShell } from "./_components/auth-shell";

export default function Home() {
  return (
    <AuthShell
      title="Welcome to Evolix"
      subtitle="Movies and shows, all in one place"
    >
      <nav className="a-actions" aria-label="Main">
        <a href="/login">Log in</a>
        <a href="/register">Create an account</a>
        <a href="/dashboard">Browse the catalog</a>
      </nav>
    </AuthShell>
  );
}
