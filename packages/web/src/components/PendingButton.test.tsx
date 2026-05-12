import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { PendingButton } from "./PendingButton";

// vitest-environment: jsdom (already set globally in vitest.config)

afterEach(() => cleanup());

describe("PendingButton", () => {
  it("renders children and forwards className + aria-label", () => {
    const { getByRole } = render(
      <PendingButton ariaLabel="Diminuer la quantité" className="x-y-z">−</PendingButton>,
    );
    const btn = getByRole("button");
    expect(btn.textContent).toBe("−");
    expect(btn.getAttribute("aria-label")).toBe("Diminuer la quantité");
    expect(btn.className).toContain("x-y-z");
  });

  it("respects the caller's `disabled` prop even when not pending", () => {
    const { getByRole } = render(
      <PendingButton disabled ariaLabel="Capped">−</PendingButton>,
    );
    expect((getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("is type=submit so it submits the enclosing form", () => {
    const { getByRole } = render(<PendingButton>Go</PendingButton>);
    expect((getByRole("button") as HTMLButtonElement).type).toBe("submit");
  });

  it("starts with aria-busy='false' when no in-flight action", () => {
    const { getByRole } = render(<PendingButton>Go</PendingButton>);
    // Outside a <form> useFormStatus().pending is false — aria-busy follows it.
    expect(getByRole("button").getAttribute("aria-busy")).toBe("false");
  });
});
