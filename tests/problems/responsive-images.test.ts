import { describe, expect, it } from "vitest";
import { imageSrcSet, TMDB_IMAGE_WIDTHS } from "@/lib/images";

describe("TMDB responsive image attributes", () => {
  it.each([null, undefined, "", "https://evil.test/a.jpg", "/../a.jpg", "/a.jpg?x=1"])("rejects unsafe or missing path %s", (path) => {
    expect(imageSrcSet(path, "poster")).toEqual({ src: undefined, srcSet: undefined });
  });
  it.each(["poster", "backdrop", "profile", "logo"] as const)("uses valid width descriptors for %s", (kind) => {
    const image = imageSrcSet("/fixture.jpg", kind);
    expect(image.srcSet?.split(", ")).toEqual(TMDB_IMAGE_WIDTHS[kind].map((w) => `https://image.tmdb.org/t/p/w${w}/fixture.jpg ${w}w`));
    expect(image.srcSet).not.toMatch(/h632|original/);
  });
  it("caps card candidates at their existing source resolution", () => {
    expect(imageSrcSet("/fixture.jpg", "poster", 342).srcSet).not.toContain("500w");
    expect(imageSrcSet("/fixture.jpg", "backdrop", 780).srcSet).not.toContain("1280w");
  });
  it("keeps useful fallbacks and serves SVG originals without fake widths", () => {
    expect(imageSrcSet("/fixture.jpg", "poster").src).toContain("/w342/");
    expect(imageSrcSet("/fixture.jpg", "backdrop").src).toContain("/w780/");
    expect(imageSrcSet("/fixture.svg", "logo")).toEqual({ src: "https://image.tmdb.org/t/p/original/fixture.svg", srcSet: undefined });
  });
});
