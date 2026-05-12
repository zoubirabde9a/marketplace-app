import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { PlaceOrderSubmit } from "./PlaceOrderSubmit";

afterEach(() => cleanup());

describe("PlaceOrderSubmit", () => {
  it("renders 'Passer la commande' when idle", () => {
    const { getByRole } = render(<PlaceOrderSubmit />);
    expect(getByRole("button").textContent).toBe("Passer la commande");
  });

  it("is type=submit so it submits the enclosing checkout form", () => {
    const { getByRole } = render(<PlaceOrderSubmit />);
    expect((getByRole("button") as HTMLButtonElement).type).toBe("submit");
  });

  it("starts with aria-busy='false' when no action is in flight", () => {
    const { getByRole } = render(<PlaceOrderSubmit />);
    expect(getByRole("button").getAttribute("aria-busy")).toBe("false");
  });

  it("starts enabled when no action is in flight (renders disabled='' only when pending)", () => {
    const { getByRole } = render(<PlaceOrderSubmit />);
    expect((getByRole("button") as HTMLButtonElement).disabled).toBe(false);
  });
});
