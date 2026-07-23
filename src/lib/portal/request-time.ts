import type { ReadyAppConfiguration } from "@/lib/config";

export const MOCK_OFFICE_NOW_HEADER = "x-portal-mock-now";
export const MOCK_OFFICE_FAULT_HEADER = "x-portal-mock-fault";

const MOCK_OFFICE_FAULTS = [
  "installation",
  "authentication",
  "maintenance",
] as const;

export type MockOfficeFault = (typeof MOCK_OFFICE_FAULTS)[number];

export function officeFaultForRequest(
  requestHeaders: Pick<Headers, "get">,
  configuration: ReadyAppConfiguration,
): MockOfficeFault | null {
  if (
    configuration.environment !== "test" ||
    configuration.serviceMode !== "mock"
  ) {
    return null;
  }

  const controlledFault = requestHeaders.get(MOCK_OFFICE_FAULT_HEADER);
  return MOCK_OFFICE_FAULTS.find((fault) => fault === controlledFault) ?? null;
}

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
