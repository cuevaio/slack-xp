import { PortalServiceError } from "@/lib/portal/server";
import type { SafetyAuthority } from "@/lib/safety/server";

export function portalOrNeonAuthority(
  error: unknown,
): Extract<SafetyAuthority, "neon" | "portal"> {
  if (error instanceof PortalServiceError) {
    return "portal";
  }
  return "neon";
}
