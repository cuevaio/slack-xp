import { HR_REPORT_NOTIFICATION_CHANNEL_ID } from "@/lib/hr-reports/contract";
import { officeEventChannelId } from "@/lib/office-events/contract";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";
import { listOfficeChannels } from "@/lib/portal/channels";
import type { PortalAuthority, PortalToken } from "@/lib/portal/types";

export class PortalEligibilityError extends Error {
  constructor() {
    super("Complete New Employee Setup before entering an Office Channel.");
    this.name = "PortalEligibilityError";
  }
}

type PortalSessionIdentity = {
  id: string;
  fullName: string;
  imageUrl: string | null;
  isOperator?: boolean;
};

export type OfficePortalSession = PortalToken & {
  channelIds: readonly string[];
  eventChannelId: string;
};

export async function issueOfficePortalSession({
  identity,
  onboarding,
  portal,
  now = new Date(),
}: {
  identity: PortalSessionIdentity;
  onboarding: OnboardingSnapshot | null;
  portal: PortalAuthority;
  now?: Date;
}): Promise<OfficePortalSession> {
  if (
    !onboarding ||
    onboarding.clerkUserId !== identity.id ||
    onboarding.step !== "complete" ||
    !onboarding.completedAt
  ) {
    throw new PortalEligibilityError();
  }

  const channelIds = listOfficeChannels(now).map(({ id }) => id);
  const eventChannelId = officeEventChannelId(now);
  const membershipChannelIds = [
    ...channelIds,
    eventChannelId,
    ...(identity.isOperator ? [HR_REPORT_NOTIFICATION_CHANNEL_ID] : []),
  ];
  const portalIdentity = {
    userId: identity.id,
    claims: {
      username: identity.fullName,
      avatar: identity.imageUrl,
    },
  };
  await Promise.all(
    membershipChannelIds.map((channelId) =>
      portal.ensureMembership({ channelId, ...portalIdentity }),
    ),
  );
  return {
    channelIds,
    eventChannelId,
    ...(await portal.mintToken({
      channelIds: membershipChannelIds,
      ...portalIdentity,
    })),
  };
}
