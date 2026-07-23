import type { ReadyAppConfiguration } from "@/lib/config";

export const MOCK_OFFICE_NOW_HEADER = "x-portal-mock-now";
export const MOCK_OFFICE_FAULT_HEADER = "x-portal-mock-fault";

export type MockOfficeFault = "installation" | "authentication" | "maintenance";

function permitsMockRequestControls(
  configuration: ReadyAppConfiguration,
): boolean {
  return (
    configuration.environment === "test" && configuration.serviceMode === "mock"
  );
}

export function officeFaultForRequest(
  requestHeaders: Pick<Headers, "get">,
  configuration: ReadyAppConfiguration,
): MockOfficeFault | null {
  if (!permitsMockRequestControls(configuration)) {
    return null;
  }

  const controlledFault = requestHeaders.get(MOCK_OFFICE_FAULT_HEADER);
  switch (controlledFault) {
    case "installation":
    case "authentication":
    case "maintenance":
      return controlledFault;
    default:
      return null;
  }
}

export function officeNowForRequest(
  requestHeaders: Pick<Headers, "get">,
  configuration: ReadyAppConfiguration,
  fallback: Date = new Date(),
): Date {
  if (!permitsMockRequestControls(configuration)) {
    return fallback;
  }

  const controlledValue = requestHeaders.get(MOCK_OFFICE_NOW_HEADER);
  if (!controlledValue) return fallback;
  const controlledNow = new Date(controlledValue);
  return Number.isFinite(controlledNow.getTime()) ? controlledNow : fallback;
}
