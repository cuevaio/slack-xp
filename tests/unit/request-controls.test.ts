import { describe, expect, test } from "bun:test";
import type { ReadyAppConfiguration } from "@/lib/config";
import {
  MOCK_OFFICE_FAULT_HEADER,
  MOCK_OFFICE_NOW_HEADER,
  type MockOfficeFault,
  officeFaultForRequest,
  officeNowForRequest,
} from "@/lib/portal/request-controls";

const mockConfiguration = {
  status: "ready",
  environment: "test",
  serviceMode: "mock",
  values: {},
} satisfies ReadyAppConfiguration;

const uncontrolledConfigurations = [
  {
    status: "ready",
    environment: "local",
    serviceMode: "mock",
    values: {},
  },
  {
    status: "ready",
    environment: "test",
    serviceMode: "live",
    values: {},
  },
  {
    status: "ready",
    environment: "production",
    serviceMode: "live",
    values: {},
  },
] satisfies ReadyAppConfiguration[];

describe("request controls", () => {
  test("accepts the controlled request clock only in test mock mode", () => {
    const controlled = "2030-01-02T03:04:05.000Z";
    const fallback = new Date("2026-07-22T12:00:00.000Z");
    const requestHeaders = new Headers({
      [MOCK_OFFICE_NOW_HEADER]: controlled,
    });

    expect(
      officeNowForRequest(requestHeaders, mockConfiguration, fallback),
    ).toEqual(new Date(controlled));
    for (const configuration of uncontrolledConfigurations) {
      expect(officeNowForRequest(requestHeaders, configuration, fallback)).toBe(
        fallback,
      );
    }
  });

  test("accepts controlled office faults only in test mock mode", () => {
    const controlledFaults: MockOfficeFault[] = [
      "installation",
      "authentication",
      "maintenance",
    ];

    for (const fault of controlledFaults) {
      const requestHeaders = new Headers({
        [MOCK_OFFICE_FAULT_HEADER]: fault,
      });
      expect(officeFaultForRequest(requestHeaders, mockConfiguration)).toBe(
        fault,
      );
      for (const configuration of uncontrolledConfigurations) {
        expect(officeFaultForRequest(requestHeaders, configuration)).toBeNull();
      }
    }

    expect(
      officeFaultForRequest(
        new Headers({ [MOCK_OFFICE_FAULT_HEADER]: "unknown" }),
        mockConfiguration,
      ),
    ).toBeNull();
  });
});
