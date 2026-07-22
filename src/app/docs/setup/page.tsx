import Link from "next/link";
import { LIVE_ENVIRONMENT_VARIABLES } from "@/lib/config";

export default function SetupPage() {
  return (
    <main className="installation-shell">
      <article className="system-window">
        <header className="window-titlebar">
          <span>Portal Messenger Setup Guide</span>
          <span aria-hidden="true">?</span>
        </header>
        <div className="installation-content">
          <div className="warning-icon" aria-hidden="true">
            i
          </div>
          <div>
            <p className="eyebrow">Fork-safe configuration</p>
            <h1>Connect your services</h1>
            <p>
              Copy <code>.env.example</code> to <code>.env.local</code>, select
              <code> SERVICE_MODE=live</code>, and configure these variables:
            </p>
            <ul className="variable-list">
              {LIVE_ENVIRONMENT_VARIABLES.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                  <span>required</span>
                </li>
              ))}
            </ul>
            <p>
              Use separate Clerk, Portal, and Neon resources for production.
              Never expose values without a <code>NEXT_PUBLIC_</code> prefix to
              browser code. Restart the development server after changing the
              environment.
            </p>
            <Link className="classic-button" href="/office">
              Recheck installation
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
}
