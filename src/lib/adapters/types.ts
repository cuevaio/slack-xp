import type {
  EmploymentPortalAuthority,
  EmploymentRepository,
} from "@/lib/employment/contract";
import type {
  HRReportInvalidationPublisher,
  HRReportNotificationPublisher,
  HRReportRepository,
} from "@/lib/hr-reports/contract";
import type {
  MessageRemovalInvalidationPublisher,
  MessageRemovalRepository,
} from "@/lib/message-removals/contract";
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
  EmploymentPortalAuthority &
  ProfileInvalidationPublisher &
  ScriptedSystemEventPublisher &
  HRReportInvalidationPublisher &
  MessageRemovalInvalidationPublisher &
  HRReportNotificationPublisher & {
    listChannels(now?: Date): Promise<readonly OfficeChannel[]>;
  };

export type NeonAdapter = OnboardingRepository &
  EmploymentRepository &
  ProfileRepository &
  OfficeDayRepository &
  HRReportRepository &
  MessageRemovalRepository;

export type ServiceAdapters = {
  kind: "mock" | "live";
  portal: PortalAdapter;
  neon: NeonAdapter;
};
