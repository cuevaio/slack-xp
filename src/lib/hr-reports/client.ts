"use client";

import {
  type QueryClient,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";
import {
  HR_REPORT_CATEGORIES,
  PROFILE_HR_REPORT_CATEGORIES,
} from "@/lib/hr-reports/contract";
import type { HRReportReviewItem } from "@/lib/hr-reports/service";

export const hrReportQueueQueryKey = ["hr-report-review-queue"] as const;
const HR_REPORT_REPAIR_INTERVAL_MS = 30_000;

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function isResolution(
  value: unknown,
): value is NonNullable<HRReportReviewItem["resolution"]> {
  if (typeof value !== "object" || value === null) return false;
  const resolution = value as Partial<
    NonNullable<HRReportReviewItem["resolution"]>
  >;
  return (
    typeof resolution.actionId === "string" &&
    typeof resolution.operatorId === "string" &&
    resolution.action === "dismissed" &&
    (resolution.privateNote === null ||
      typeof resolution.privateNote === "string") &&
    isIsoTimestamp(resolution.actedAt) &&
    isIsoTimestamp(resolution.createdAt)
  );
}

function isHRReportReviewItem(value: unknown): value is HRReportReviewItem {
  if (typeof value !== "object" || value === null) return false;
  const report = value as Partial<HRReportReviewItem> & Record<string, unknown>;
  const hasConsistentResolution =
    (report.state === "open" && report.resolution === null) ||
    (report.state === "dismissed" && isResolution(report.resolution));
  const common =
    typeof report.reportId === "string" &&
    typeof report.reporterId === "string" &&
    typeof report.href === "string" &&
    (report.state === "open" || report.state === "dismissed") &&
    isIsoTimestamp(report.createdAt) &&
    isIsoTimestamp(report.updatedAt) &&
    hasConsistentResolution;
  if (!common) return false;

  if (report.subjectType === "message") {
    return (
      HR_REPORT_CATEGORIES.some((category) => category === report.category) &&
      typeof report.officeDay === "string" &&
      typeof report.officeChannelId === "string" &&
      typeof report.messageId === "string"
    );
  }
  return (
    report.subjectType === "profile" &&
    PROFILE_HR_REPORT_CATEGORIES.some(
      (category) => category === report.category,
    ) &&
    typeof report.profileId === "string"
  );
}

async function fetchHRReportQueue(): Promise<HRReportReviewItem[]> {
  const response = await fetch("/api/office/operator/hr-reports", {
    credentials: "include",
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof payload !== "object" ||
    payload === null ||
    !("reports" in payload) ||
    !Array.isArray(payload.reports) ||
    !payload.reports.every(isHRReportReviewItem)
  ) {
    throw new Error("The HR Report review queue is unavailable.");
  }
  return payload.reports;
}

export function hrReportQueueQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: hrReportQueueQueryKey,
    queryFn: fetchHRReportQueue,
    enabled,
    staleTime: HR_REPORT_REPAIR_INTERVAL_MS,
    refetchInterval: enabled ? HR_REPORT_REPAIR_INTERVAL_MS : false,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  });
}

export function useHRReportQueue(enabled: boolean) {
  return useQuery(hrReportQueueQueryOptions(enabled));
}

export async function requestHRReportDismissal(input: {
  reportId: string;
  privateNote: string | null;
}): Promise<{ reportId: string; status: "dismissed" | "already-dismissed" }> {
  const response = await fetch("/api/office/operator/hr-reports", {
    method: "PATCH",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof payload !== "object" ||
    payload === null ||
    !("reportId" in payload) ||
    typeof payload.reportId !== "string" ||
    !("status" in payload) ||
    (payload.status !== "dismissed" && payload.status !== "already-dismissed")
  ) {
    throw new Error("The HR Report could not be dismissed.");
  }
  return { reportId: payload.reportId, status: payload.status };
}

export function invalidateHRReportQueue(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: hrReportQueueQueryKey });
}
