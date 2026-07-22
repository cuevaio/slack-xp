"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  HR_REPORT_CATEGORIES,
  type HRReportCategory,
  PROFILE_HR_REPORT_CATEGORIES,
} from "@/lib/hr-reports/contract";
import {
  HR_REPORT_CATEGORY_LABELS,
  PROFILE_HR_REPORT_CATEGORY_LABELS,
} from "@/lib/hr-reports/domain";
import type { SafePortalChatMessage } from "@/lib/portal/chat";

type HRReportSubmissionResult =
  | "created"
  | "already-reported"
  | "created-notification-pending"
  | "error";

type HRReportRequestContext =
  | { officeChannelId: string; messageId: string }
  | { subjectType: "profile"; profileId: string };

type HRReportControlsProps<Category extends HRReportCategory> = {
  categories: readonly [Category, ...Category[]];
  categoryLabels: Readonly<Record<Category, string>>;
  context: HRReportRequestContext;
  description: string;
  subjectLabel: string;
};

function parseSubmissionResult(
  value: unknown,
): HRReportSubmissionResult | null {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    return null;
  }

  if (value.status === "already-reported") {
    return "already-reported";
  }

  if (value.status !== "created") {
    return null;
  }

  if ("notificationStatus" in value && value.notificationStatus === "pending") {
    return "created-notification-pending";
  }

  return "created";
}

function isSubmitted(result: HRReportSubmissionResult | null): boolean {
  return (
    result === "created" ||
    result === "already-reported" ||
    result === "created-notification-pending"
  );
}

function confirmationMessage(
  result: HRReportSubmissionResult | null,
  subjectLabel: string,
): string | null {
  switch (result) {
    case "created":
      return "Private HR Report submitted.";
    case "already-reported":
      return `You already have an open report for this ${subjectLabel}.`;
    case "created-notification-pending":
      return "Private HR Report submitted.";
    default:
      return null;
  }
}

function HRReportControls<Category extends HRReportCategory>({
  categories,
  categoryLabels,
  context,
  description,
  subjectLabel,
}: HRReportControlsProps<Category>) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [category, setCategory] = useState<Category>(categories[0]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<HRReportSubmissionResult | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstCategoryRef = useRef<HTMLInputElement>(null);
  const instanceId = useId();
  const titleId = `hr-report-title-${instanceId}`;

  useEffect(() => {
    if (dialogOpen) {
      firstCategoryRef.current?.focus();
    }
  }, [dialogOpen]);

  function closeDialog(): void {
    setDialogOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    event.stopPropagation();
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      closeDialog();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const controls = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        "input:not([disabled]), button:not([disabled])",
      ),
    ];
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      return;
    }

    const movingBeforeFirst =
      event.shiftKey && document.activeElement === first;
    const movingAfterLast = !event.shiftKey && document.activeElement === last;
    if (movingBeforeFirst || movingAfterLast) {
      event.preventDefault();
      if (movingBeforeFirst) {
        last.focus();
      } else {
        first.focus();
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const response = await fetch("/api/office/hr-reports", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...context, category }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const submissionResult = parseSubmissionResult(payload);
      if (!response.ok || !submissionResult) {
        throw new Error("HR Report unavailable");
      }

      setResult(submissionResult);
      closeDialog();
    } catch {
      setResult("error");
    } finally {
      setSubmitting(false);
    }
  }

  const submitted = isSubmitted(result);
  const confirmation = confirmationMessage(result, subjectLabel);

  return (
    <div className="hr-report-controls">
      <button
        aria-haspopup="dialog"
        className="message-action-button"
        disabled={submitted}
        onClick={() => {
          setResult(null);
          setDialogOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        {submitted ? "Reported to HR" : "Report to HR"}
      </button>
      {dialogOpen ? (
        <div
          aria-labelledby={titleId}
          aria-modal="true"
          className="hr-report-dialog-backdrop"
          onKeyDown={handleDialogKeyDown}
          role="dialog"
        >
          <form className="hr-report-dialog" onSubmit={submit}>
            <h2 id={titleId}>Private HR Report</h2>
            <p>{description}</p>
            <fieldset>
              <legend>Reason for review</legend>
              {categories.map((option, index) => (
                <label key={option}>
                  <input
                    checked={category === option}
                    name={`hr-report-category-${instanceId}`}
                    onChange={() => setCategory(option)}
                    ref={index === 0 ? firstCategoryRef : undefined}
                    required
                    type="radio"
                    value={option}
                  />
                  {categoryLabels[option]}
                </label>
              ))}
            </fieldset>
            {result === "error" ? (
              <p className="chat-error" role="alert">
                HR Report could not be submitted. Please try again.
              </p>
            ) : null}
            <div className="hr-report-dialog-actions">
              <Button disabled={submitting} onClick={closeDialog} type="button">
                Cancel
              </Button>
              <Button disabled={submitting} type="submit" variant="primary">
                {submitting ? "Submitting…" : "Submit private report"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
      {confirmation ? <output>{confirmation}</output> : null}
    </div>
  );
}

export function MessageHRReportControls({
  message,
}: {
  message: SafePortalChatMessage;
}) {
  return (
    <HRReportControls
      categories={HR_REPORT_CATEGORIES}
      categoryLabels={HR_REPORT_CATEGORY_LABELS}
      context={{
        officeChannelId: message.channelId,
        messageId: message.id,
      }}
      description="Choose why you want an Operator to review this message. Reporting it does not remove it automatically."
      subjectLabel="message"
    />
  );
}

export function ProfileHRReportControls({ profileId }: { profileId: string }) {
  return (
    <HRReportControls
      categories={PROFILE_HR_REPORT_CATEGORIES}
      categoryLabels={PROFILE_HR_REPORT_CATEGORY_LABELS}
      context={{ subjectType: "profile", profileId }}
      description="Choose why you want an Operator to review this profile."
      subjectLabel="New Hire Profile"
    />
  );
}
