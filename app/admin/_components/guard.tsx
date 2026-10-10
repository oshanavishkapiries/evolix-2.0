import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE } from "@/lib/auth/http";
import { checkAdminToken } from "@/lib/auth/admin";

/** Server-side admin check; children only render for verified admins. */
export async function AdminGuard({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const result = await checkAdminToken(token);
  if (result.status === "unauthenticated") redirect("/login?next=/admin");
  if (result.status === "forbidden") redirect("/dashboard");
  return <>{children}</>;
}
