import Link from "next/link";
import { PageHeader } from "../../_components/page-header";
import { UserForm } from "../../_components/user-form";

export default function NewUserPage() {
  return (
    <>
      <PageHeader title="New user" />
      <p className="mt-2 text-sm"><Link href="/admin/users">← All users</Link></p>
      <UserForm />
    </>
  );
}
