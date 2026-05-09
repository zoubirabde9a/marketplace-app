import clsx from "clsx";

export function CounterfeitBadge({ risk }: { risk: "low" | "elevated" | "high" }) {
  if (risk === "low") return null;
  return (
    <span
      title={
        risk === "high"
          ? "High counterfeit risk — listing under review."
          : "Elevated counterfeit risk — supply-chain documentation pending."
      }
      className={clsx(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border",
        risk === "high"
          ? "bg-bad/10 text-bad border-bad/30"
          : "bg-warn/10 text-warn border-warn/30",
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {risk === "high" ? "Suppressed" : "Under review"}
    </span>
  );
}
