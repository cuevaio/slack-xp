import Link from "next/link";

export default function SetupPage() {
  return (
    <main className="installation-shell">
      <section className="system-window" aria-labelledby="setup-page-title">
        <header className="window-titlebar">
          <span>Portal Messenger</span>
        </header>
        <div className="installation-content">
          <div className="warning-icon" aria-hidden="true">
            !
          </div>
          <div>
            <h1 id="setup-page-title">The office is unavailable</h1>
            <p>
              Portal Messenger is not ready right now. Please try again later.
            </p>
            <Link className="classic-button" href="/office">
              Try again
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
