import type { Metadata } from "next";
import { imageUrl, isImagePath } from "@/lib/images";
import { CastList } from "./cast-list";
import { Gallery } from "./gallery";
import { Trailers } from "./trailers";

type Common = {
  title: string;
  cast: { name: string; character: string; profilePath: string | null }[];
  videos: React.ComponentProps<typeof Trailers>["videos"];
  backdropPath: string | null;
  galleryBackdrops: string[];
};

/** Cast, trailers and backdrop gallery shared by movie and show pages. */
export function MediaSections({ item }: { item: Common }) {
  const paths = [...new Set([item.backdropPath, ...item.galleryBackdrops])].filter(isImagePath);
  return (
    <>
      <CastList cast={item.cast} />
      <Trailers videos={item.videos} />
      <Gallery paths={paths} title={item.title} />
    </>
  );
}

export function detailMetadata(title: string, overview: string, backdropPath: string | null): Metadata {
  const image = imageUrl(backdropPath, "w780");
  const description = overview.length > 200 ? `${overview.slice(0, 197)}...` : overview || undefined;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, images: image ? [image] : undefined },
  };
}
