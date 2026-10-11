import { StatusScreen } from "./_components/status-screen";

export default function NotFound() {
  return (
    <StatusScreen
      code="404"
      title="Page not found"
      message="The page you are looking for does not exist or has been moved."
      actions={[{ label: "Back to Evolix", href: "/dashboard", primary: true }]}
    />
  );
}
