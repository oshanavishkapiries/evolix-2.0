import { PageHeader } from "../../_components/page-header";
import { MovieCreate } from "../../_components/movie-create";

export default function NewMoviePage() {
  return (
    <>
      <PageHeader title="Add movie" />
      <MovieCreate />
    </>
  );
}
