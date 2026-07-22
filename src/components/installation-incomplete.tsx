import { buttonVariants } from "@/components/ui/button";
import type { AppConfiguration } from "@/lib/config";

type IncompleteConfiguration = Extract<
  AppConfiguration,
  { status: "incomplete" }
>;

export function InstallationIncomplete({
  configuration: _configuration,
}: {
  configuration: IncompleteConfiguration;
}) {
  return (
    <main className="installation-shell">
      <section className="system-window" aria-labelledby="installation-title">
        <header className="window-titlebar">
          <span>Portal Messenger</span>
        </header>
        <div className="installation-content">
          <div className="warning-icon" aria-hidden="true">
            !
          </div>
          <div>
            <h1 id="installation-title">The office is unavailable</h1>
            <p>
              Portal Messenger is not ready right now. Please try again later.
            </p>
            <a className={buttonVariants()} href="/office">
              Try again
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
