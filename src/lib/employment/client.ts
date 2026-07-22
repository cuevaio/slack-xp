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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSendHomeResponse(value: unknown): value is SendHomeResponse {
  return (
    isObject(value) &&
    typeof value.actionId === "string" &&
    (value.status === "sent-home" || value.status === "already-sent-home") &&
    typeof value.officeDay === "string" &&
    typeof value.expiresAt === "string"
  );
}

function parseEmploymentAccessDecision(
  value: unknown,
): EmploymentAccessDecision | null {
  if (!isObject(value)) return null;

  if (
    value.eligible === true &&
    value.reason === null &&
    value.until === null
  ) {
    return { eligible: true, reason: null, until: null };
  }

  if (
    value.eligible !== false ||
    (value.reason !== "sent-home" &&
      value.reason !== "terminated" &&
      value.reason !== "deleted") ||
    (value.until !== null && typeof value.until !== "string")
  ) {
    return null;
  }

  const until = value.until === null ? null : new Date(value.until);
  if (until && !Number.isFinite(until.getTime())) return null;

  return { eligible: false, reason: value.reason, until };
}

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
  if (!response.ok || !isSendHomeResponse(payload)) {
    throw new Error("The New Hire could not be sent home.");
  }
  return payload;
}

export async function fetchEmploymentAccess(): Promise<EmploymentAccessDecision> {
  const response = await fetch("/api/office/employment", {
    credentials: "include",
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  const access = response.ok ? parseEmploymentAccessDecision(payload) : null;
  if (!access) throw new Error("Employment access is unavailable.");

  return access;
}
