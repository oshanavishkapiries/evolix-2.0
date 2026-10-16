import Link from "next/link";

/** Shown instead of the player (and as a Home banner) while the account waits for admin approval. */
export function ApprovalNotice({ banner = false }: { banner?: boolean }) {
  return (
    <div className={banner ? "v-notice" : "v-empty"} role="status">
      <h2>Your account is waiting for approval</h2>
      <p className="v-muted">You can browse everything, but watching movies and TV shows unlocks once an admin approves your account.</p>
      {!banner && <Link href="/dashboard" className="v-btn">Back to Home</Link>}
    </div>
  );
}
