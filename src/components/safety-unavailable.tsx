type SafetyUnavailableReason = "maintenance" | "projection";

const SAFETY_UNAVAILABLE_CONTENT: Record<
  SafetyUnavailableReason,
  { heading: string; detail: string }
> = {
  maintenance: {
    heading: "Portal Messenger is under maintenance",
    detail:
      "Active chat and publishing are paused until an Operator restores service.",
  },
  projection: {
    heading: "Message safety checks are unavailable",
    detail:
      "Portal Messenger cannot verify current New Hire Profiles and Removed Messages, so no conversation content is being shown.",
  },
};

export function SafetyUnavailable({
  reason,
}: {
  reason: SafetyUnavailableReason;
}) {
  const content = SAFETY_UNAVAILABLE_CONTENT[reason];

  return (
    <main className="office-shell">
      <section className="installation-window" role="alert">
        <header className="window-titlebar">
          <span>Portal Messenger</span>
        </header>
        <div className="installation-content">
          <p className="eyebrow">Shared Public Office</p>
          <h1>{content.heading}</h1>
          <p>{content.detail}</p>
          <p>Please try again later.</p>
        </div>
      </section>
    </main>
  );
}
