"use client";

import {
  type QueryClient,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";

export const operatorStateQueryKey = ["operator-state"] as const;
const OPERATOR_REPAIR_INTERVAL_MS = 30_000;

type OperatorState = { isOperator: boolean };

async function fetchOperatorState(): Promise<OperatorState> {
  const response = await fetch("/api/office/session", {
    credentials: "include",
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof payload !== "object" ||
    payload === null ||
    !("isOperator" in payload) ||
    typeof payload.isOperator !== "boolean"
  ) {
    throw new Error("Operator authorization is unavailable.");
  }
  return { isOperator: payload.isOperator };
}

export function operatorStateQueryOptions(initialIsOperator: boolean) {
  return queryOptions({
    queryKey: operatorStateQueryKey,
    queryFn: fetchOperatorState,
    initialData: { isOperator: initialIsOperator },
    staleTime: 0,
    refetchInterval: OPERATOR_REPAIR_INTERVAL_MS,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  });
}

export function useOperatorState(initialIsOperator: boolean) {
  return useQuery(operatorStateQueryOptions(initialIsOperator));
}

export function invalidateOperatorState(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: operatorStateQueryKey });
}
