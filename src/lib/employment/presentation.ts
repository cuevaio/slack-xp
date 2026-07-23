import type { EmploymentAccessReason } from "@/lib/employment/contract";

type EmploymentAccessEndedCopy = {
  title: string;
  description: string;
};

export function getEmploymentAccessEndedCopy(
  reason: EmploymentAccessReason,
): EmploymentAccessEndedCopy {
  switch (reason) {
    case "sent-home":
      return {
        title: "You were sent home for this Office Day",
        description:
          "You can return automatically at the start of the next Office Day.",
      };
    case "deleted":
    case "terminated":
      return {
        title: "Your desk is unavailable",
        description:
          "Your New Hire Profile is not currently eligible to enter the Shared Public Office.",
      };
  }
}
