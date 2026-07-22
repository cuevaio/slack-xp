import { officeEventChannelId } from "@/lib/office-events/contract";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";
import { generalChannelId } from "@/lib/portal/chat";
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
};

export type OfficePortalSession = PortalToken & {
  channelId: string;
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

  const channelId = generalChannelId(now);
  const eventChannelId = officeEventChannelId(now);
  const channelIds = [channelId, eventChannelId] as const;
  const portalIdentity = {
    userId: identity.id,
    claims: {
      username: identity.fullName,
      avatar: identity.imageUrl,
    },
  };
  for (const membershipChannelId of channelIds) {
    await portal.ensureMembership({
      channelId: membershipChannelId,
      ...portalIdentity,
    });
  }
  return {
    channelId,
    eventChannelId,
    ...(await portal.mintToken({
      channelIds,
      ...portalIdentity,
    })),
  };
}
