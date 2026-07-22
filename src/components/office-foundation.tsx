import { EmployeeRecordDialog } from "@/components/employee-record-dialog";
import { PortalChat } from "@/components/portal-chat";
import type { ServiceAdapters } from "@/lib/adapters";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import { officeEventChannelIdForDay } from "@/lib/office-events/contract";
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
  now = new Date(),
}: {
  adapters: ServiceAdapters;
  identity: AuthenticatedNewHire;
  onboarding: OnboardingSnapshot;
  portalPublishableKey?: string;
  now?: Date;
}) {
  const channels = await adapters.portal.listChannels(now);
  if (channels.length !== OFFICE_CHANNEL_DEFINITIONS.length) {
    throw new Error("The Office Channel directory is incomplete.");
  }
  const generalChannel = channels.find(({ slug }) => slug === "general");
  if (!generalChannel) {
    throw new Error("The General Office Channel is not configured.");
  }
  const [, currentOfficeDay = ""] = generalChannel.id.split(":");
  const eventChannelId = officeEventChannelIdForDay(currentOfficeDay);

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
          employeeRecord={<EmployeeRecordDialog onboarding={onboarding} />}
          eventChannelId={eventChannelId}
          officeDay={currentOfficeDay}
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
