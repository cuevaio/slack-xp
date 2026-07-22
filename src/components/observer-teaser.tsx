import Link from "next/link";

const previewMessages = [
  {
    initials: "CL",
    name: "Clippy from Legal",
    time: "8:42 AM",
    message: "Please stop calling the outage a surprise migration.",
    tone: "gold",
  },
  {
    initials: "PP",
    name: "Pat Pending",
    time: "8:47 AM",
    message: "Does anyone know which printer is the production server?",
    tone: "mint",
  },
  {
    initials: "IT",
    name: "Portal Systems IT",
    time: "9:01 AM",
    message: "The quarterly synergy has been rebooted successfully.",
    tone: "blue",
  },
] as const;

function PortalMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "portal-mark portal-mark-small" : "portal-mark"}>
      <span aria-hidden="true">P</span>
      <span className="sr-only">Portal Systems</span>
    </span>
  );
}

export function ObserverTeaser() {
  return (
    <main className="observer-shell">
      <section className="observer-desktop" aria-labelledby="teaser-title">
        <div className="desktop-glow desktop-glow-one" aria-hidden="true" />
        <div className="desktop-glow desktop-glow-two" aria-hidden="true" />
        <div className="desktop-workspace">
          <div className="observer-copy">
            <div className="desktop-wordmark">
              <PortalMark />
              <div>
                <strong>PORTAL SYSTEMS</strong>
                <span className="wordmark-subtitle">Corporate Edition</span>
              </div>
            </div>
            <h1 id="teaser-title">
              Your coworkers are online.
              <span>Management remains unavailable.</span>
            </h1>
            <p className="observer-lede">
              Clock in to one shared office full of questionable coworkers,
              daily conversations, and software from another century.
            </p>
            <Link className="primary-action" href="/office" prefetch={false}>
              Enter the Shared Public Office
              <span aria-hidden="true"> →</span>
            </Link>
            <p className="privacy-note">
              Preview only. Sign in to join the live office.
            </p>
          </div>

          <section className="preview-window" aria-label="Office preview">
            <header className="window-titlebar observer-titlebar">
              <span className="window-title">
                <PortalMark compact /># general
              </span>
            </header>
            <div className="preview-channelbar">
              <div>
                <strong># general</strong>
                <span>The hallway, but with more reply-all.</span>
              </div>
            </div>
            <div className="preview-messages">
              {previewMessages.map((message) => (
                <article key={message.name}>
                  <div
                    className={`avatar avatar-${message.tone}`}
                    aria-hidden="true"
                  >
                    {message.initials}
                  </div>
                  <div>
                    <div className="message-meta">
                      <strong>{message.name}</strong>
                      <time>{message.time}</time>
                    </div>
                    <p>{message.message}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
