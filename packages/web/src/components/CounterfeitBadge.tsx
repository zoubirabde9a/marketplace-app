import clsx from "clsx";

export function CounterfeitBadge({ risk }: { risk: "low" | "elevated" | "high" }) {
  if (risk === "low") return null;
  const explanation =
    risk === "high"
      ? "Risque de contrefaçon élevé — annonce en cours d'examen."
      : "Risque de contrefaçon · documentation fournisseur en attente.";
  return (
    <span
      role="status"
      title={explanation}
      aria-label={explanation}
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border",
        risk === "high"
          ? "bg-bad/10 text-bad border-bad/30"
          : "bg-warn/10 text-warn border-warn/30",
      )}
    >
      <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-current" />
      {risk === "high" ? "Suspendu" : "En examen"}
    </span>
  );
}
