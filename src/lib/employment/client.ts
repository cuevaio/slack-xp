"use client";

import type {
  EmploymentAccessDecision,
  SendHomeRequest,
} from "@/lib/employment/contract";

export type SendHomeResponse = {
  actionId: string;
  status: "sent-home" | "already-sent-home";
  officeDay: string;
  expiresAt: string;
};

export async function requestSendHome(
  input: SendHomeRequest,
): Promise<SendHomeResponse> {
  const response = await fetch("/api/office/operator/send-home", {
    method: "POST",
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
    !("actionId" in payload) ||
    typeof payload.actionId !== "string" ||
    !("status" in payload) ||
    (payload.status !== "sent-home" &&
      payload.status !== "already-sent-home") ||
    !("officeDay" in payload) ||
    typeof payload.officeDay !== "string" ||
    !("expiresAt" in payload) ||
    typeof payload.expiresAt !== "string"
  ) {
    throw new Error("The New Hire could not be sent home.");
  }
  return payload as SendHomeResponse;
}

export async function fetchEmploymentAccess(): Promise<EmploymentAccessDecision> {
  const response = await fetch("/api/office/employment", {
    credentials: "include",
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof payload !== "object" ||
    payload === null ||
    !("eligible" in payload) ||
    !("reason" in payload) ||
    !("until" in payload)
  ) {
    throw new Error("Employment access is unavailable.");
  }
  if (
    payload.eligible === true &&
    payload.reason === null &&
    payload.until === null
  ) {
    return { eligible: true, reason: null, until: null };
  }
  if (
    payload.eligible === false &&
    (payload.reason === "sent-home" ||
      payload.reason === "terminated" ||
      payload.reason === "deleted") &&
    (payload.until === null || typeof payload.until === "string")
  ) {
    const until = payload.until === null ? null : new Date(payload.until);
    if (until && !Number.isFinite(until.getTime())) {
      throw new Error("Employment access is unavailable.");
    }
    return { eligible: false, reason: payload.reason, until };
  }
  throw new Error("Employment access is unavailable.");
}
