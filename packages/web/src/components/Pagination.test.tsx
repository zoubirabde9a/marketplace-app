import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Pagination } from "./Pagination";

afterEach(() => cleanup());

function getLinks(container: HTMLElement) {
  return Array.from(container.querySelectorAll("a")).map((a) => ({
    href: a.getAttribute("href"),
    rel: a.getAttribute("rel"),
    ariaDisabled: a.getAttribute("aria-disabled"),
    tabIndex: a.getAttribute("tabindex"),
  }));
}

describe("Pagination", () => {
  it("renders nothing when there is no cursor and no next page", () => {
    const { container } = render(
      <Pagination
        currentParams={new URLSearchParams("q=phone")}
        nextCursor={null}
        resultsLen={0}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders inside a <nav aria-label=Pagination>", () => {
    const { container } = render(
      <Pagination
        currentParams={new URLSearchParams("q=phone")}
        nextCursor="next-token"
        resultsLen={20}
      />,
    );
    const nav = container.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav!.getAttribute("aria-label")).toBe("Pagination");
  });

  it("on page 1 (no cursor): disables Back, enables Next with rel=next", () => {
    const { container } = render(
      <Pagination
        currentParams={new URLSearchParams("q=phone")}
        nextCursor="cursor-2"
        resultsLen={20}
      />,
    );
    const links = getLinks(container);
    expect(links).toHaveLength(2);
    const [back, next] = links;
    // Back is disabled
    expect(back.ariaDisabled).toBe("true");
    expect(back.tabIndex).toBe("-1");
    expect(back.rel).toBeNull();
    // Next has rel=next, real href, tabbable
    expect(next.ariaDisabled).toBe("false");
    expect(next.rel).toBe("next");
    expect(next.href).toBe("/search?q=phone&cursor=cursor-2");
  });

  it("on a cursor page: enables both, Back drops cursor with rel=prev, Next swaps cursor with rel=next", () => {
    const { container } = render(
      <Pagination
        currentParams={new URLSearchParams("q=phone&cursor=current")}
        nextCursor="next-token"
        resultsLen={20}
      />,
    );
    const links = getLinks(container);
    const [back, next] = links;
    expect(back.rel).toBe("prev");
    expect(back.href).toBe("/search?q=phone");
    expect(back.ariaDisabled).toBe("false");
    expect(next.rel).toBe("next");
    expect(next.href).toBe("/search?q=phone&cursor=next-token");
    expect(next.ariaDisabled).toBe("false");
  });

  it("on the last page: enables Back, disables Next", () => {
    const { container } = render(
      <Pagination
        currentParams={new URLSearchParams("q=phone&cursor=current")}
        nextCursor={null}
        resultsLen={5}
      />,
    );
    const [back, next] = getLinks(container);
    expect(back.ariaDisabled).toBe("false");
    expect(next.ariaDisabled).toBe("true");
    expect(next.tabIndex).toBe("-1");
    expect(next.rel).toBeNull();
  });
});
