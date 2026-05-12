import { describe, expect, it, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { AddToCartSubmit } from "./AddToCartSubmit";

afterEach(() => cleanup());

describe("AddToCartSubmit", () => {
  it("shows the caller's label when in stock and idle", () => {
    const { getByRole } = render(
      <AddToCartSubmit inStock label="Ajouter au panier" />,
    );
    expect(getByRole("button").textContent).toBe("Ajouter au panier");
  });

  it("shows 'Rupture de stock' and disables when inStock=false (even before pending logic)", () => {
    const { getByRole } = render(
      <AddToCartSubmit inStock={false} label="Ajouter au panier" />,
    );
    const btn = getByRole("button") as HTMLButtonElement;
    expect(btn.textContent).toBe("Rupture de stock");
    expect(btn.disabled).toBe(true);
  });

  it("accepts a custom pendingLabel prop (caller-supplied for 'Buy now' surface)", () => {
    // We can't trigger useFormStatus.pending outside of an actual server-
    // action submission, but we can at least assert the prop is accepted and
    // the idle render still uses `label`.
    const { getByRole } = render(
      <AddToCartSubmit inStock label="Acheter maintenant" pendingLabel="Achat en cours…" />,
    );
    expect(getByRole("button").textContent).toBe("Acheter maintenant");
  });

  it("renders aria-busy='false' when idle", () => {
    const { getByRole } = render(
      <AddToCartSubmit inStock label="Ajouter au panier" />,
    );
    expect(getByRole("button").getAttribute("aria-busy")).toBe("false");
  });
});
