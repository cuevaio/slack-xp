import type { ServiceAdapters } from "@/lib/adapters/types";
import { seedAndPublishOfficeDay } from "@/lib/office-days/service";
import { MockPortalUnavailableError } from "@/lib/portal/mock";
import { officeDay } from "@/lib/portal/office-day";
import { PortalServiceError } from "@/lib/portal/server";

export function isAuthorizedVercelCronRequest(
  request: Pick<Request, "headers">,
  cronSecret: string,
): boolean {
  return (
    cronSecret.length > 0 &&
    request.headers.get("authorization") === `Bearer ${cronSecret}`
  );
}

export async function runOfficeDayCron({
  adapters,
  now,
}: {
  adapters: ServiceAdapters;
  now: Date;
}) {
  return seedAndPublishOfficeDay({
    officeDay: officeDay(now),
    now,
    repository: adapters.neon,
    publisher: adapters.portal,
  });
}

export async function repairOfficeDayOnEntry({
  adapters,
  now,
  correlationId = crypto.randomUUID(),
}: {
  adapters: ServiceAdapters;
  now: Date;
  correlationId?: string;
}) {
  try {
    return await runOfficeDayCron({ adapters, now });
  } catch (error) {
    console.error(
      JSON.stringify({
        operation: "office_day_lazy_repair",
        correlationId,
        authority:
          error instanceof PortalServiceError ||
          error instanceof MockPortalUnavailableError
            ? "portal"
            : "neon",
        status: "unavailable",
      }),
    );
    return null;
  }
}
