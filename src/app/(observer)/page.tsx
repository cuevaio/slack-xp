import Link from "next/link";

const previewMessages = [
  ["Clippy from Legal", "Please stop calling the outage a surprise migration."],
  ["Pat Pending", "Does anyone know which printer is the production server?"],
  ["System Event", "The quarterly synergy has been rebooted successfully."],
] as const;

export default function ObserverPage() {
  return (
    <main className="observer-shell">
      <section className="observer-copy">
        <p className="eyebrow">Portal Systems proudly presents</p>
        <h1>
          Your coworkers are online.
          <span>Management remains unavailable.</span>
        </h1>
        <p className="observer-lede">
          Portal Messenger is a communal realtime office wrapped in the warm,
          gray plastic of corporate software from 2001.
        </p>
        <Link className="primary-action" href="/office">
          Enter the Shared Public Office
        </Link>
        <p className="privacy-note">
          Observer preview only. Live messages, presence, and Portal services
          are not loaded here.
        </p>
      </section>
      <section className="preview-window" aria-label="Non-live product preview">
        <header className="window-titlebar">
          <span>general - Portal Messenger</span>
          <span aria-hidden="true">_ □ ×</span>
        </header>
        <div className="preview-toolbar">
          File&nbsp;&nbsp; Edit&nbsp;&nbsp; Coworkers&nbsp;&nbsp; Help
        </div>
        <div className="preview-messages">
          {previewMessages.map(([name, message]) => (
            <article key={name}>
              <div className="avatar" aria-hidden="true">
                {name.slice(0, 1)}
              </div>
              <div>
                <strong>{name}</strong>
                <p>{message}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="preview-status">
          STATIC PREVIEW · 0 LIVE CONNECTIONS
        </div>
      </section>
    </main>
  );
}
