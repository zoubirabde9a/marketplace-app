import { describe, expect, it } from "vitest";
import { upscaleOuedknissForCrawler } from "./images";

describe("upscaleOuedknissForCrawler", () => {
  it("upscales a /400/ Ouedkniss CDN URL to /1200/", () => {
    expect(
      upscaleOuedknissForCrawler(
        "https://cdn8.ouedkniss.com/400/medias/announcements/images/abc/Photo1.jpg",
      ),
    ).toBe("https://cdn8.ouedkniss.com/1200/medias/announcements/images/abc/Photo1.jpg");
  });

  it("upscales other small sizes (e.g. /128/, /200/) to /1200/", () => {
    expect(
      upscaleOuedknissForCrawler("https://cdn7.ouedkniss.com/128/medias/x/y.jpg"),
    ).toBe("https://cdn7.ouedkniss.com/1200/medias/x/y.jpg");
    expect(
      upscaleOuedknissForCrawler("https://cdn9.ouedkniss.com/200/medias/foo.png"),
    ).toBe("https://cdn9.ouedkniss.com/1200/medias/foo.png");
  });

  it("is idempotent: a /1200/ URL stays /1200/", () => {
    const url = "https://cdn8.ouedkniss.com/1200/medias/x.jpg";
    expect(upscaleOuedknissForCrawler(url)).toBe(url);
  });

  it("does not touch non-Ouedkniss URLs", () => {
    const passthroughs = [
      "https://cdn.example.com/400/medias/x.jpg",
      "https://teno-store.com/icon.svg",
      "https://cdn7.ouedkniss.com/static/banner.png", // no /\d+/medias/ segment
      "/relative/path.jpg",
    ];
    for (const url of passthroughs) {
      expect(upscaleOuedknissForCrawler(url)).toBe(url);
    }
  });

  it("handles http:// (not just https) so a misconfigured upstream still upscales", () => {
    expect(
      upscaleOuedknissForCrawler("http://cdn8.ouedkniss.com/400/medias/x.jpg"),
    ).toBe("http://cdn8.ouedkniss.com/1200/medias/x.jpg");
  });
});
