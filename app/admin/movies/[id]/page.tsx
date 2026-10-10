import { Suspense } from "react";
import { MovieEditor } from "../../_components/movie-editor";

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MovieEditor id={id} />;
}

export default function MoviePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <Editor params={params} />
    </Suspense>
  );
}
