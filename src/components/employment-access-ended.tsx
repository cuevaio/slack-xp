import type { EmploymentAccessDeniedDecision } from "@/lib/employment/contract";

export function EmploymentAccessEnded({
  access,
}: {
  access: EmploymentAccessDeniedDecision;
}) {
  const sentHome = access.reason === "sent-home";
  return (
    <main className="office-shell">
      <section
        className="messenger-window"
        aria-labelledby="access-ended-title"
      >
        <header className="window-titlebar">
          <span>Portal Messenger: Corporate Edition</span>
          <span aria-hidden="true">×</span>
        </header>
        <div className="shift-ended-content">
          <p className="eyebrow">Shared Public Office access ended</p>
          <h1 id="access-ended-title">
            {sentHome
              ? "You were sent home for this Office Day"
              : "Your desk is unavailable"}
          </h1>
          <p>
            {sentHome
              ? "Your Portal connections were closed. You can return automatically after the next midnight UTC Office Day boundary."
              : "Your New Hire record is not currently eligible to enter the Shared Public Office."}
          </p>
          {access.until ? (
            <p>
              Eligible again after{" "}
              <time dateTime={access.until.toISOString()}>
                {access.until.toISOString()}
              </time>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
