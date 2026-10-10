import { Suspense } from "react";
import { ShowEditor } from "../../_components/show-editor";

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ShowEditor id={id} />;
}

export default function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <Editor params={params} />
    </Suspense>
  );
}
