import type { OnboardingRepository } from "@/lib/onboarding/types";
import type { OfficeChannel } from "@/lib/portal/channels";
import type { PortalAuthority } from "@/lib/portal/types";
import type {
  ProfileInvalidationPublisher,
  ProfileRepository,
} from "@/lib/profiles/types";

export type PortalAdapter = PortalAuthority &
  ProfileInvalidationPublisher & {
    listChannels(now?: Date): Promise<readonly OfficeChannel[]>;
  };

export type NeonAdapter = OnboardingRepository & ProfileRepository;

export type ServiceAdapters = {
  kind: "mock" | "live";
  portal: PortalAdapter;
  neon: NeonAdapter;
};
