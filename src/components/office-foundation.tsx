import { PortalChat } from "@/components/portal-chat";
import type { ServiceAdapters } from "@/lib/adapters";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";
import { OFFICE_CHANNEL_DEFINITIONS } from "@/lib/portal/channels";

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
  if (channels.length !== OFFICE_CHANNEL_DEFINITIONS.length) {
    throw new Error("The Office Channel directory is incomplete.");
  }

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
        <PortalChat
          canSignOut={identity.authentication === "mock"}
          channels={channels}
          displayName={onboarding.displayName}
          identityId={identity.id}
          isOperator={identity.isOperator}
          jobTitle={onboarding.jobTitle}
          {...(adapters.kind === "mock"
            ? { mode: "mock" as const }
            : {
                mode: "live" as const,
                publishableKey:
                  requirePortalPublishableKey(portalPublishableKey),
              })}
        />
      </section>
    </main>
  );
}
