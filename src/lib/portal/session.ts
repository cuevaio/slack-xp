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

export type GeneralPortalSession = PortalToken & { channelId: string };

export async function issueGeneralPortalSession({
  identity,
  onboarding,
  portal,
  now = new Date(),
}: {
  identity: PortalSessionIdentity;
  onboarding: OnboardingSnapshot | null;
  portal: PortalAuthority;
  now?: Date;
}): Promise<GeneralPortalSession> {
  if (
    !onboarding ||
    onboarding.clerkUserId !== identity.id ||
    onboarding.step !== "complete" ||
    !onboarding.completedAt
  ) {
    throw new PortalEligibilityError();
  }

  const channelId = generalChannelId(now);
  const input = {
    channelId,
    userId: identity.id,
    claims: {
      username: identity.fullName,
      avatar: identity.imageUrl,
    },
  };
  await portal.ensureMembership(input);
  return { channelId, ...(await portal.mintToken(input)) };
}
