import type { ServiceAdapters } from "@/lib/adapters";
import type { AuthenticatedNewHire } from "@/lib/auth/types";

export async function OfficeFoundation({
  adapters,
  identity,
}: {
  adapters: ServiceAdapters;
  identity: AuthenticatedNewHire;
}) {
  const channels = await adapters.portal.listChannels();
  const newHire = await adapters.neon.getNewHire(identity.id);

  return (
    <main className="office-shell">
      {adapters.kind === "mock" ? (
        <output className="mock-watermark">MOCK SERVICES - NO LIVE DATA</output>
      ) : null}
      <section className="messenger-window" aria-labelledby="office-title">
        <header className="window-titlebar">
          <span id="office-title">Portal Messenger: Corporate Edition</span>
          <span aria-hidden="true">_ □ ×</span>
        </header>
        <div className="office-body">
          <aside className="channel-panel" aria-label="Office Channels">
            <p className="eyebrow">Shared Public Office</p>
            <h1>{`Welcome, ${identity.fullName}`}</h1>
            {newHire ? <p className="job-title">{newHire.jobTitle}</p> : null}
            {identity.isOperator ? (
              <p className="operator-badge">Operator access</p>
            ) : null}
            <nav>
              {channels.map((channel) => (
                <a href={`#${channel.id}`} key={channel.id}>
                  <span># {channel.name}</span>
                  {channel.unreadCount > 0 ? (
                    <strong>{channel.unreadCount}</strong>
                  ) : null}
                </a>
              ))}
            </nav>
            {identity.authentication === "mock" ? (
              <form action="/api/auth/sign-out" method="post">
                <button
                  className="classic-button sign-out-button"
                  type="submit"
                >
                  Sign out
                </button>
              </form>
            ) : null}
          </aside>
          <section className="conversation-panel">
            <div className="conversation-heading">
              <span className="presence-dot" aria-hidden="true" />
              Foundation status
            </div>
            <div className="system-message">
              <strong>Portal Systems IT</strong>
              <p>
                {adapters.kind === "mock"
                  ? "Deterministic mock authentication, Portal, and Neon adapters are online. Nothing on this screen came from a cloud service."
                  : "Live service configuration passed validation. Authentication integration is ready for the next installation step."}
              </p>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
