import { MockPortalUnavailableError } from "@/lib/portal/mock";
import { PortalServiceError } from "@/lib/portal/server";
import type { SafetyAuthority } from "@/lib/safety/server";

export function portalOrNeonAuthority(
  error: unknown,
): Extract<SafetyAuthority, "neon" | "portal"> {
  if (
    error instanceof PortalServiceError ||
    error instanceof MockPortalUnavailableError
  ) {
    return "portal";
  }
  return "neon";
}
