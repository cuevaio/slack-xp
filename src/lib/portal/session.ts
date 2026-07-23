import type { EmploymentAccessDecision } from "@/lib/employment/contract";
import { HR_REPORT_NOTIFICATION_CHANNEL_ID } from "@/lib/hr-reports/contract";
import { officeEventChannelId } from "@/lib/office-events/contract";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";
import {
  listOfficeChannels,
  OFFICE_CHANNEL_DEFINITIONS,
  officeDayChannelIdsForAccessControl,
} from "@/lib/portal/channels";
import { officeDay } from "@/lib/portal/office-day";
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
  employmentAccess,
}: {
  identity: PortalSessionIdentity;
  onboarding: OnboardingSnapshot | null;
  portal: PortalAuthority;
  now?: Date;
  employmentAccess: EmploymentAccessDecision;
}): Promise<OfficePortalSession> {
  if (
    !onboarding ||
    onboarding.clerkUserId !== identity.id ||
    onboarding.step !== "complete" ||
    !onboarding.completedAt ||
    !employmentAccess.eligible
  ) {
    throw new PortalEligibilityError();
  }

  const channelIds = listOfficeChannels(now).map(({ id }) => id);
  const eventChannelId = officeEventChannelId(now);
  const membershipChannelIds = [
    ...officeDayChannelIdsForAccessControl(
      [...OFFICE_CHANNEL_DEFINITIONS.map(({ slug }) => slug), "office-events"],
      officeDay(now),
    ),
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
