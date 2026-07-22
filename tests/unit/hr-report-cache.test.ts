import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  hrReportQueueQueryKey,
  invalidateHRReportQueue,
} from "@/lib/hr-reports/client";
import {
  invalidateOperatorState,
  operatorStateQueryKey,
} from "@/lib/operators/client";

describe("Operator review query caches", () => {
  test("invalidates only canonical HR Report queue queries", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(hrReportQueueQueryKey, []);
    queryClient.setQueryData(["unrelated"], "unchanged");

    await invalidateHRReportQueue(queryClient);

    expect(
      queryClient.getQueryState(hrReportQueueQueryKey)?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(["unrelated"])?.isInvalidated).toBe(false);
  });

  test("invalidates Operator status without touching report state", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(operatorStateQueryKey, { isOperator: true });
    queryClient.setQueryData(hrReportQueueQueryKey, []);

    await invalidateOperatorState(queryClient);

    expect(
      queryClient.getQueryState(operatorStateQueryKey)?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(hrReportQueueQueryKey)?.isInvalidated,
    ).toBe(false);
  });
});
