import type { AppConfiguration } from "@/lib/config";

type IncompleteConfiguration = Extract<
  AppConfiguration,
  { status: "incomplete" }
>;

export function InstallationIncomplete({
  configuration,
}: {
  configuration: IncompleteConfiguration;
}) {
  return (
    <main className="installation-shell">
      <section className="system-window" aria-labelledby="installation-title">
        <header className="window-titlebar">
          <span>Portal Messenger Setup</span>
          <span aria-hidden="true">!</span>
        </header>
        <div className="installation-content">
          <div className="warning-icon" aria-hidden="true">
            !
          </div>
          <div>
            <p className="eyebrow">Configuration required</p>
            <h1 id="installation-title">Installation Incomplete</h1>
            <p>
              This {configuration.environment} deployment is closed until its
              service configuration is valid. No live office data was loaded.
            </p>
            <h2>Check these variable names</h2>
            <ul className="variable-list">
              {configuration.issues.map((issue) => (
                <li key={issue.name}>
                  <code>{issue.name}</code>
                  <span>{issue.reason}</span>
                </li>
              ))}
            </ul>
            <a className="classic-button" href="/docs/setup">
              Open setup guide
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
