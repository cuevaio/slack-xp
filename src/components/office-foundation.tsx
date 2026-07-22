import type { ServiceAdapters } from "@/lib/adapters";

export async function OfficeFoundation({
  adapters,
}: {
  adapters: ServiceAdapters;
}) {
  const user = await adapters.clerk.getCurrentUser();
  const channels = await adapters.portal.listChannels();
  const newHire = user ? await adapters.neon.getNewHire(user.id) : null;

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
            <h1>{user ? `Welcome, ${user.fullName}` : "Ready to clock in"}</h1>
            {newHire ? <p className="job-title">{newHire.jobTitle}</p> : null}
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
                  ? "Deterministic Clerk, Portal, and Neon adapters are online. Nothing on this screen came from a cloud service."
                  : "Live service configuration passed validation. Authentication integration is ready for the next installation step."}
              </p>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
