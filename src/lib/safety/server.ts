import type { EnvironmentSource } from "@/lib/config";

export type SafetyAuthority = "application" | "clerk" | "neon" | "portal";

export type SafetyLogEntry = {
  operation: string;
  correlationId: string;
  authority: SafetyAuthority;
  status: "unavailable" | "maintenance" | "pending" | number;
  officeChannelId?: string;
};

export type SafetyLogger = (entry: SafetyLogEntry) => void;

export type SafetyBoundaryOptions = {
  correlationId?: string;
  logger?: SafetyLogger;
  timeoutMs?: number;
};

export class SafetyDependencyTimeoutError extends Error {
  constructor() {
    super("A required safety dependency timed out.");
    this.name = "SafetyDependencyTimeoutError";
  }
}

export function isMaintenanceActive(
  env: EnvironmentSource = process.env,
): boolean {
  const value = env.PORTAL_MESSENGER_MAINTENANCE;
  return value !== undefined && value !== "off";
}

export function requestCorrelationId(headers: Headers): string {
  const supplied = headers.get("x-request-id")?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{1,128}$/u.test(supplied)) {
    return supplied;
  }
  return crypto.randomUUID();
}

export const logSafetyEvent: SafetyLogger = (entry) => {
  console.error(JSON.stringify(entry));
};

export async function withSafetyDependencyTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new SafetyDependencyTimeoutError()),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
