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
};

export type OfficePortalSession = PortalToken & { channelIds: string[] };

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
  const identityClaims = {
    userId: identity.id,
    claims: {
      username: identity.fullName,
      avatar: identity.imageUrl,
    },
  };
  await Promise.all(
    channelIds.map((channelId) =>
      portal.ensureMembership({ channelId, ...identityClaims }),
    ),
  );
  return {
    channelIds,
    ...(await portal.mintToken({ channelIds, ...identityClaims })),
  };
}
