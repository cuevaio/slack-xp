import type {
  HRReportInvalidationPublisher,
  HRReportNotificationPublisher,
  HRReportRepository,
} from "@/lib/hr-reports/contract";
import type {
  OfficeDayRepository,
  ScriptedSystemEventPublisher,
} from "@/lib/office-days/types";
import type { OnboardingRepository } from "@/lib/onboarding/types";
import type { OfficeChannel } from "@/lib/portal/channels";
import type { PortalAuthority } from "@/lib/portal/types";
import type {
  ProfileInvalidationPublisher,
  ProfileRepository,
} from "@/lib/profiles/types";

export type PortalAdapter = PortalAuthority &
  ProfileInvalidationPublisher &
  ScriptedSystemEventPublisher &
  HRReportInvalidationPublisher &
  HRReportNotificationPublisher & {
    listChannels(now?: Date): Promise<readonly OfficeChannel[]>;
  };

export type NeonAdapter = OnboardingRepository &
  ProfileRepository &
  OfficeDayRepository &
  HRReportRepository;

export type ServiceAdapters = {
  kind: "mock" | "live";
  portal: PortalAdapter;
  neon: NeonAdapter;
};
