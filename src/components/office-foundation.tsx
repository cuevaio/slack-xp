import { PortalChat } from "@/components/portal-chat";
import type { ServiceAdapters } from "@/lib/adapters";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import { officeEventChannelIdForDay } from "@/lib/office-events/contract";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";

function requirePortalPublishableKey(value: string | undefined): string {
  if (!value) {
    throw new Error("Validated live configuration is missing the Portal key.");
  }
  return value;
}

export async function OfficeFoundation({
  adapters,
  identity,
  onboarding,
  portalPublishableKey,
}: {
  adapters: ServiceAdapters;
  identity: AuthenticatedNewHire;
  onboarding: OnboardingSnapshot;
  portalPublishableKey?: string;
}) {
  const channels = await adapters.portal.listChannels();
  const generalChannel = channels[0];
  if (!generalChannel) {
    throw new Error("The General Office Channel is not configured.");
  }
  const eventChannelId = officeEventChannelIdForDay(
    generalChannel.id.split(":", 1)[0] ?? "",
  );

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
            <h1>Welcome, {onboarding.displayName}</h1>
            <p className="job-title">{onboarding.jobTitle}</p>
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
            <PortalChat
              channelId={generalChannel.id}
              eventChannelId={eventChannelId}
              displayName={onboarding.displayName}
              identityId={identity.id}
              {...(adapters.kind === "mock"
                ? { mode: "mock" as const }
                : {
                    mode: "live" as const,
                    publishableKey:
                      requirePortalPublishableKey(portalPublishableKey),
                  })}
            />
          </section>
        </div>
      </section>
    </main>
  );
}
