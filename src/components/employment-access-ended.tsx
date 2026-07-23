import type { EmploymentAccessDeniedDecision } from "@/lib/employment/contract";
import { getEmploymentAccessEndedCopy } from "@/lib/employment/presentation";

export function EmploymentAccessEnded({
  access,
}: {
  access: EmploymentAccessDeniedDecision;
}) {
  const copy = getEmploymentAccessEndedCopy(access.reason);
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
          <h1 id="access-ended-title">{copy.title}</h1>
          <p>{copy.description}</p>
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
