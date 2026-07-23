import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { EmploymentAccessEnded } from "@/components/employment-access-ended";
import { InstallationIncomplete } from "@/components/installation-incomplete";
import { ObserverTeaser } from "@/components/observer-teaser";
import { OfficeFoundation } from "@/components/office-foundation";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { SafetyUnavailable } from "@/components/safety-unavailable";
import { createServiceAdapters } from "@/lib/adapters";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import type { EmploymentAccessDecision } from "@/lib/employment/contract";
import { parseHRReportReviewTarget } from "@/lib/hr-reports/domain";
import { profileFromIdentity } from "@/lib/onboarding/profile-authority";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";
import { repairProfileProjection } from "@/lib/profiles/service";
import { SAFETY_PROJECTION_TIMEOUT_MS } from "@/lib/safety/contract";
import { portalOrNeonAuthority } from "@/lib/safety/failure-authority";
import {
  isMaintenanceActive,
  logSafetyEvent,
  requestCorrelationId,
  withSafetyDependencyTimeout,
} from "@/lib/safety/server";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Portal Messenger: Corporate Edition",
  description:
    "Meet your coworkers in a delightfully outdated shared online office.",
};

type HomePageSearchParams = Promise<
  Record<string, string | string[] | undefined>
>;

function serializeSearchParams(values: Awaited<HomePageSearchParams>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else if (value !== undefined) {
      search.set(key, value);
    }
  }
  return search.toString();
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: HomePageSearchParams;
}) {
  await connection();
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return <InstallationIncomplete configuration={configuration} />;
  }

  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return <ObserverTeaser />;
  }

  const requestHeaders = await headers();
  if (isMaintenanceActive()) {
    return <SafetyUnavailable reason="maintenance" />;
  }
  const adapters = createServiceAdapters(configuration);
  const correlationId = requestCorrelationId(requestHeaders);
  const now = new Date();

  try {
    await withSafetyDependencyTimeout(
      repairProfileProjection(adapters.neon, identity, adapters.portal),
      SAFETY_PROJECTION_TIMEOUT_MS,
    );
  } catch (error) {
    logSafetyEvent({
      operation: "profile_projection_repair",
      correlationId,
      authority: portalOrNeonAuthority(error),
      status: "unavailable",
    });
    return <SafetyUnavailable reason="projection" />;
  }

  let employmentAccess: EmploymentAccessDecision;
  try {
    employmentAccess = await withSafetyDependencyTimeout(
      adapters.neon.getEmploymentAccess(identity.id, now),
      SAFETY_PROJECTION_TIMEOUT_MS,
    );
  } catch {
    logSafetyEvent({
      operation: "employment_access",
      correlationId,
      authority: "neon",
      status: "unavailable",
    });
    return <SafetyUnavailable reason="projection" />;
  }
  if (!employmentAccess.eligible) {
    return <EmploymentAccessEnded access={employmentAccess} />;
  }

  let onboarding: OnboardingSnapshot;
  try {
    onboarding = await withSafetyDependencyTimeout(
      adapters.neon.enterNewHire(profileFromIdentity(identity)),
      SAFETY_PROJECTION_TIMEOUT_MS,
    );
  } catch {
    logSafetyEvent({
      operation: "office_entry",
      correlationId,
      authority: "neon",
      status: "unavailable",
    });
    return <SafetyUnavailable reason="projection" />;
  }

  if (onboarding.step !== "complete") {
    return <OnboardingWizard initialOnboarding={onboarding} />;
  }

  const reviewTarget = identity.isOperator
    ? parseHRReportReviewTarget(serializeSearchParams(await searchParams))
    : null;

  return (
    <OfficeFoundation
      adapters={adapters}
      identity={identity}
      onboarding={onboarding}
      now={now}
      portalPublishableKey={configuration.values.NEXT_PUBLIC_PORTAL_KEY}
      reviewTarget={reviewTarget}
    />
  );
}
