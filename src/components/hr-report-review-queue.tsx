"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  invalidateHRReportQueue,
  requestHRReportDismissal,
  useHRReportQueue,
} from "@/lib/hr-reports/client";
import {
  HR_REPORT_CATEGORY_LABELS,
  PROFILE_HR_REPORT_CATEGORY_LABELS,
} from "@/lib/hr-reports/domain";
import type { HRReportReviewItem } from "@/lib/hr-reports/service";
import { invalidateOperatorState } from "@/lib/operators/client";
import { formatOfficeTimestamp } from "@/lib/portal/office-day";

function reportCategoryLabel(report: HRReportReviewItem): string {
  return report.subjectType === "message"
    ? HR_REPORT_CATEGORY_LABELS[report.category]
    : PROFILE_HR_REPORT_CATEGORY_LABELS[report.category];
}

function reportContextLabel(report: HRReportReviewItem): string {
  return report.subjectType === "message"
    ? "Review message context"
    : "Review current New Hire Profile";
}

function HRReportReviewRow({ report }: { report: HRReportReviewItem }) {
  const queryClient = useQueryClient();
  const [privateNote, setPrivateNote] = useState("");
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
        <strong>
          {report.subjectType === "message"
            ? "Message HR Report"
            : "New Hire Profile HR Report"}
        </strong>
        <span className="hr-review-state" data-state={report.state}>
          {report.state}
        </span>
      </div>
      <p>{reportCategoryLabel(report)}</p>
      <small>
        Submitted{" "}
        <time dateTime={report.createdAt} title={report.createdAt}>
          {formatOfficeTimestamp(Date.parse(report.createdAt))}
        </time>
      </small>
      <a href={report.href}>{reportContextLabel(report)}</a>
      {report.state === "open" ? (
        <form onSubmit={submit}>
          <label htmlFor={`hr-private-note-${report.reportId}`}>
            Private Operator note (optional)
          </label>
          <textarea
            id={`hr-private-note-${report.reportId}`}
            maxLength={1_000}
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
            <p role="alert">Dismissal failed. Operator access was rechecked.</p>
          ) : null}
        </form>
      ) : (
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
