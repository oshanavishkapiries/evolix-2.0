import { PageHeader } from "../../_components/page-header";
import { ShowCreate } from "../../_components/show-create";

export default function NewShowPage() {
  return (
    <>
      <PageHeader title="Add show" />
      <ShowCreate />
    </>
  );
}
