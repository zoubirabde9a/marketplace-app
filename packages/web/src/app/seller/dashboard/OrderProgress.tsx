// Compact horizontal pipeline visualization for a single order's status.
// Renders four steps — paid · préparation · expédiée · livrée — with the
// current status marked, completed steps filled, future steps dimmed.
// Inspired by the OrderProgress component in the teno-store reference
// project but shrunk to fit a list row instead of a full detail page.
//
// Server component — pure rendering off the status string. The order
// state machine in packages/domain only progresses linearly through
// paid → fulfilling → shipped → delivered, so a list-position lookup
// is unambiguous.
//
// Off-pipeline statuses (created/authorized = pre-payment;
// cancelled/refunded/disputed = exception paths) bypass the stepper and
// render a single labelled chip instead — putting them on the linear
// rail would either lie about progression (cancelled at step 3?) or
// require a branching layout that's overkill for a list row.

const PIPELINE_STATUSES = ["paid", "fulfilling", "shipped", "delivered"] as const;
type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

const PIPELINE_LABEL: Record<PipelineStatus, string> = {
  paid: "Payée",
  fulfilling: "Préparation",
  shipped: "Expédiée",
  delivered: "Livrée",
};

// Off-pipeline display: status → { label, tone }. Tones mirror the
// existing ORDER_STATUS_CLASS palette in page.tsx so the visual language
// stays consistent across the dashboard.
const OFF_PIPELINE_CHIP: Record<string, { label: string; tone: "muted" | "danger" | "warn" }> = {
  created: { label: "Créée", tone: "muted" },
  authorized: { label: "Autorisée", tone: "muted" },
  cancelled: { label: "Annulée", tone: "danger" },
  refunded: { label: "Remboursée", tone: "muted" },
  disputed: { label: "Litige", tone: "danger" },
};

const TONE_CLASS = {
  muted: "border-line text-ink-mute bg-bg/40",
  warn: "border-warn/40 text-warn bg-warn/10",
  danger: "border-bad/40 text-bad bg-bad/10",
} as const;

function isPipeline(s: string): s is PipelineStatus {
  return (PIPELINE_STATUSES as readonly string[]).includes(s);
}

export function OrderProgress({ status }: { status: string }): React.JSX.Element {
  if (!isPipeline(status)) {
    const off = OFF_PIPELINE_CHIP[status] ?? { label: status, tone: "muted" as const };
    return (
      <span
        role="img"
        aria-label={`Statut : ${off.label}`}
        title={status}
        className={
          "inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] uppercase tracking-widest " +
          TONE_CLASS[off.tone]
        }
      >
        {off.label}
      </span>
    );
  }

  const currentIndex = PIPELINE_STATUSES.indexOf(status);

  return (
    <ol
      role="img"
      aria-label={`Étape ${currentIndex + 1} sur ${PIPELINE_STATUSES.length} : ${PIPELINE_LABEL[status]}`}
      title={`${PIPELINE_LABEL[status]} (étape ${currentIndex + 1}/${PIPELINE_STATUSES.length})`}
      // role=img + descriptive aria-label collapses the stepper into a
      // single screen-reader announcement. Without it, NVDA reads each
      // list item separately ("step 1 of 4, step 2 of 4…") and the
      // compact visual gets verbose at audio speed.
      className="inline-flex items-center gap-0 align-middle"
    >
      {PIPELINE_STATUSES.map((step, i) => {
        const isPast = i < currentIndex;
        const isCurrent = i === currentIndex;
        // Dot styling: current = filled accent ring with inner dot;
        // past = filled solid; future = hollow muted. Sized to align
        // with the surrounding xs/sm text without dominating the row.
        const dotCls = isPast
          ? "bg-ok border-ok"
          : isCurrent
          ? "bg-accent border-accent ring-2 ring-accent/30"
          : "bg-transparent border-line";
        const connectorCls = isPast || isCurrent ? "bg-ok/60" : "bg-line";
        return (
          <li key={step} className="flex items-center" aria-hidden>
            <span
              className={"inline-block w-2.5 h-2.5 rounded-full border " + dotCls}
            />
            {/* Connector line to the next step. Last step has no
                trailing connector. Width small enough that 4 steps
                fit comfortably on a phone next to the order number. */}
            {i < PIPELINE_STATUSES.length - 1 && (
              <span className={"inline-block w-4 h-0.5 " + connectorCls} />
            )}
          </li>
        );
      })}
      {/* Visible label of the current step alongside the dots. Keeps
          the stepper informative even when the seller doesn't hover
          the title attribute. */}
      <span className="ml-2 text-[10px] uppercase tracking-widest text-ink-soft">
        {PIPELINE_LABEL[status]}
      </span>
    </ol>
  );
}
