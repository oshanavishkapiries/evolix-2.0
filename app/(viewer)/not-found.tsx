import Link from "next/link";

export default function ViewerNotFound() {
  return (
    <div className="v-empty v-status">
      <p className="v-status-code" aria-hidden="true">404</p>
      <h1>Not found</h1>
      <p className="v-muted">This title does not exist or is not available.</p>
      <Link href="/dashboard" className="v-btn v-btn-primary">Back to library</Link>
    </div>
  );
}
