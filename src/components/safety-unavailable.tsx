export function SafetyUnavailable({
  reason,
}: {
  reason: "maintenance" | "projection";
}) {
  return (
    <main className="office-shell">
      <section className="installation-window" role="alert">
        <header className="window-titlebar">
          <span>Portal Messenger</span>
        </header>
        <div className="installation-content">
          <p className="eyebrow">Shared Public Office</p>
          <h1>
            {reason === "maintenance"
              ? "Portal Messenger is under maintenance"
              : "Message safety checks are unavailable"}
          </h1>
          <p>
            {reason === "maintenance"
              ? "Active chat and publishing are paused until an Operator restores service."
              : "Portal Messenger cannot verify current New Hire Profiles and Removed Messages, so no conversation content is being shown."}
          </p>
          <p>Please try again later.</p>
        </div>
      </section>
    </main>
  );
}
