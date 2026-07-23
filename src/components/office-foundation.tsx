import { EmployeeRecordDialog } from "@/components/employee-record-dialog";
import { OfficeWindow } from "@/components/office-window";
import { PortalChat } from "@/components/portal-chat";
import type { ServiceAdapters } from "@/lib/adapters";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import type { HRReportStableContext } from "@/lib/hr-reports/contract";
import { officeEventChannelIdForDay } from "@/lib/office-events/contract";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";
import {
  isOfficeChannelSlug,
  OFFICE_CHANNEL_DEFINITIONS,
  officeDayFromChannelId,
} from "@/lib/portal/channels";

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
  reviewTarget,
  now = new Date(),
}: {
  adapters: ServiceAdapters;
  identity: AuthenticatedNewHire;
  onboarding: OnboardingSnapshot;
  portalPublishableKey?: string;
  reviewTarget?: HRReportStableContext | null;
  now?: Date;
}) {
  const channels = [...(await adapters.portal.listChannels(now))];
  if (channels.length !== OFFICE_CHANNEL_DEFINITIONS.length) {
    throw new Error("The Office Channel directory is incomplete.");
  }
  const generalChannel = channels.find(({ slug }) => slug === "general");
  if (!generalChannel) {
    throw new Error("The General Office Channel is not configured.");
  }
  const currentOfficeDay = officeDayFromChannelId(generalChannel.id) ?? "";
  if (
    reviewTarget?.subjectType === "message" &&
    reviewTarget.officeDay === currentOfficeDay &&
    !channels.some(({ id }) => id === reviewTarget.officeChannelId)
  ) {
    const [reviewChannelSlug] = reviewTarget.officeChannelId.split(":");
    const reviewChannel = isOfficeChannelSlug(reviewChannelSlug ?? "")
      ? channels.find(({ slug }) => slug === reviewChannelSlug)
      : undefined;
    if (reviewChannel) {
      channels.push({ ...reviewChannel, id: reviewTarget.officeChannelId });
    }
  }
  const eventChannelId = officeEventChannelIdForDay(currentOfficeDay);

  return (
    <main className="office-shell">
      <OfficeWindow>
        <PortalChat
          canSignOut={false}
          channels={channels}
          displayName={onboarding.displayName}
          employeeRecord={<EmployeeRecordDialog onboarding={onboarding} />}
          eventChannelId={eventChannelId}
          officeDay={currentOfficeDay}
          identityId={identity.id}
          isOperator={identity.isOperator}
          mode="live"
          publishableKey={requirePortalPublishableKey(portalPublishableKey)}
        />
      </OfficeWindow>
    </main>
  );
}
