import Link from "next/link";
import { ObserverLiveChannel } from "@/components/observer-live-channel";

function PortalMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "portal-mark portal-mark-small" : "portal-mark"}>
      <span aria-hidden="true">P</span>
      <span className="sr-only">Portal Systems</span>
    </span>
  );
}

export function ObserverTeaser({ publishableKey }: { publishableKey: string }) {
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
              Live read-only view. Sign in to send messages.
            </p>
          </div>

          <section className="preview-window" aria-label="Office preview">
            <header className="window-titlebar observer-titlebar">
              <span className="window-title">
                <PortalMark compact /># general
              </span>
            </header>
            <ObserverLiveChannel publishableKey={publishableKey} />
          </section>
        </div>
      </section>
    </main>
  );
}
