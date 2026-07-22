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
        </header>
        <div className="shift-ended-content">
          <h1 id="access-ended-title">
            {sentHome
              ? "You were sent home for this Office Day"
              : "Your desk is unavailable"}
          </h1>
          <p>
            {sentHome
              ? "You can return automatically at the start of the next Office Day."
              : "Your New Hire Profile is not currently eligible to enter the Shared Public Office."}
          </p>
          {access.until ? (
            <p>
              You can return after{" "}
              <time dateTime={access.until.toISOString()}>
                {access.until.toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
