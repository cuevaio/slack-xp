import type { ReadyAppConfiguration } from "@/lib/config";

export const MOCK_OFFICE_NOW_HEADER = "x-portal-mock-now";

export function officeNowForRequest(
  requestHeaders: Pick<Headers, "get">,
  configuration: ReadyAppConfiguration,
  fallback: Date = new Date(),
): Date {
  if (
    configuration.environment !== "test" ||
    configuration.serviceMode !== "mock"
  ) {
    return fallback;
  }

  const controlledValue = requestHeaders.get(MOCK_OFFICE_NOW_HEADER);
  if (!controlledValue) return fallback;
  const controlledNow = new Date(controlledValue);
  return Number.isFinite(controlledNow.getTime()) ? controlledNow : fallback;
}
