"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { SendHomeControl } from "@/components/send-home-control";
import {
  invalidateHRReportQueue,
  requestHRReportDismissal,
  useHRReportQueue,
} from "@/lib/hr-reports/client";
import {
  HR_REPORT_PRIVATE_NOTE_MAX_LENGTH,
  type HRReportReviewItem,
} from "@/lib/hr-reports/contract";
import {
  HR_REPORT_CATEGORY_LABELS,
  PROFILE_HR_REPORT_CATEGORY_LABELS,
} from "@/lib/hr-reports/domain";
import { invalidateOperatorState } from "@/lib/operators/client";
import { formatOfficeTimestamp } from "@/lib/portal/office-day";

function reportPresentation(report: HRReportReviewItem) {
  if (report.subjectType === "message") {
    return {
      categoryLabel: HR_REPORT_CATEGORY_LABELS[report.category],
      contextLabel: "Review message context",
      title: "Message HR Report",
    };
  }

  return {
    categoryLabel: PROFILE_HR_REPORT_CATEGORY_LABELS[report.category],
    contextLabel: "Review current New Hire Profile",
    title: "New Hire Profile HR Report",
  };
}

function HRReportResolution({ report }: { report: HRReportReviewItem }) {
  switch (report.state) {
    case "dismissed":
      return (
        <div className="hr-review-resolution">
          <small>
            Dismissed by {report.resolution?.operatorId ?? "an Operator"}
          </small>
          {report.resolution?.privateNote ? (
            <p>
              <strong>Private note:</strong> {report.resolution.privateNote}
            </p>
          ) : null}
        </div>
      );
    case "removed":
      return (
        <div className="hr-review-resolution">
          <strong>Related message removed</strong>
          <p>
            This HR Report was resolved when an Operator created the Removed
            Message projection.
          </p>
        </div>
      );
    case "actioned":
      return (
        <div className="hr-review-resolution">
          <small>Employment action recorded by an Operator</small>
        </div>
      );
    default:
      return null;
  }
}

function HRReportReviewRow({ report }: { report: HRReportReviewItem }) {
  const queryClient = useQueryClient();
  const [privateNote, setPrivateNote] = useState("");
  const presentation = reportPresentation(report);
  const privateNoteId = `hr-private-note-${report.reportId}`;
  const dismissal = useMutation({
    mutationFn: requestHRReportDismissal,
    onSuccess: () => {
      setPrivateNote("");
    },
    onError: () => {
      void invalidateOperatorState(queryClient);
    },
    onSettled: () => invalidateHRReportQueue(queryClient),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dismissal.mutate({
      reportId: report.reportId,
      privateNote: privateNote.trim() || null,
    });
  }

  return (
    <li className="hr-review-item">
      <div className="hr-review-heading">
        <strong>{presentation.title}</strong>
        <span className="hr-review-state" data-state={report.state}>
          {report.state}
        </span>
      </div>
      <p>{presentation.categoryLabel}</p>
      <small>
        Submitted{" "}
        <time dateTime={report.createdAt} title={report.createdAt}>
          {formatOfficeTimestamp(Date.parse(report.createdAt))}
        </time>
      </small>
      <a href={report.href}>{presentation.contextLabel}</a>
      {report.state === "open" ? (
        <>
          <form onSubmit={submit}>
            <label htmlFor={privateNoteId}>
              Private Operator note (optional)
            </label>
            <textarea
              id={privateNoteId}
              maxLength={HR_REPORT_PRIVATE_NOTE_MAX_LENGTH}
              onChange={(event) => setPrivateNote(event.currentTarget.value)}
              rows={3}
              value={privateNote}
            />
            <button
              className="classic-button"
              disabled={dismissal.isPending}
              type="submit"
            >
              {dismissal.isPending ? "Dismissing…" : "Dismiss HR Report"}
            </button>
            {dismissal.isError ? (
              <p role="alert">
                Dismissal failed. Operator access was rechecked.
              </p>
            ) : null}
          </form>
          {report.subjectNewHireId ? (
            <SendHomeControl
              onCompleted={() => void invalidateHRReportQueue(queryClient)}
              reportId={report.reportId}
              targetNewHireId={report.subjectNewHireId}
            />
          ) : null}
        </>
      ) : (
        <HRReportResolution report={report} />
      )}
    </li>
  );
}

export function HRReportReviewQueue({ enabled }: { enabled: boolean }) {
  const query = useHRReportQueue(enabled);
  if (!enabled) return null;

  return (
    <section aria-label="HR Report review queue" className="hr-review-queue">
      <h2>HR Review Queue</h2>
      {query.isPending ? <p>Loading private HR Reports…</p> : null}
      {query.isError ? (
        <p role="alert">The private HR Report queue is unavailable.</p>
      ) : null}
      {query.data?.length === 0 ? <p>No HR Reports to review.</p> : null}
      {query.data && query.data.length > 0 ? (
        <ul>
          {query.data.map((report) => (
            <HRReportReviewRow key={report.reportId} report={report} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
