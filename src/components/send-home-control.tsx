"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { requestSendHome } from "@/lib/employment/client";
import { SEND_HOME_PRIVATE_REASON_MAX_LENGTH } from "@/lib/employment/contract";

type SendHomeControlProps = {
  targetNewHireId: string;
  reportId?: string;
  onCompleted?(): void;
};

export function SendHomeControl({
  targetNewHireId,
  reportId,
  onCompleted,
}: SendHomeControlProps) {
  const [open, setOpen] = useState(false);
  const [privateReason, setPrivateReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [requestId] = useState(() => crypto.randomUUID());
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const instanceId = useId();
  const titleId = `send-home-title-${instanceId}`;
  const reasonId = `send-home-reason-${instanceId}`;

  useEffect(() => {
    if (open) reasonRef.current?.focus();
  }, [open]);

  function close(): void {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    event.stopPropagation();
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        "textarea:not([disabled]), button:not([disabled])",
      ),
    ];
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const reason = privateReason.trim();
    if (!reason) return;
    setSubmitting(true);
    setError(false);
    try {
      await requestSendHome({
        requestId,
        targetNewHireId,
        privateReason: reason,
        ...(reportId ? { reportId } : {}),
      });
      setCompleted(true);
      setPrivateReason("");
      close();
      onCompleted?.();
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="send-home-control">
      <button
        aria-haspopup="dialog"
        className="classic-button"
        disabled={completed}
        onClick={() => {
          setError(false);
          setOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        {completed ? "Sent Home" : "Send Home"}
      </button>
      {open ? (
        <div
          aria-labelledby={titleId}
          aria-modal="true"
          className="hr-report-dialog-backdrop"
          onKeyDown={handleKeyDown}
          role="dialog"
        >
          <form className="hr-report-dialog" onSubmit={submit}>
            <h2 id={titleId}>Send Home for this Office Day?</h2>
            <p>
              Access ends immediately and returns at the next midnight UTC
              boundary. This does not create a Termination.
            </p>
            <label htmlFor={reasonId}>Private Operator reason (required)</label>
            <textarea
              id={reasonId}
              maxLength={SEND_HOME_PRIVATE_REASON_MAX_LENGTH}
              onChange={(event) => setPrivateReason(event.currentTarget.value)}
              ref={reasonRef}
              required
              rows={4}
              value={privateReason}
            />
            {error ? (
              <p className="chat-error" role="alert">
                Send Home failed. Operator access was rechecked.
              </p>
            ) : null}
            <div className="hr-report-dialog-actions">
              <button
                className="classic-button"
                disabled={submitting}
                onClick={close}
                type="button"
              >
                Cancel
              </button>
              <button
                className="classic-button primary-action"
                disabled={submitting || privateReason.trim().length === 0}
                type="submit"
              >
                {submitting ? "Sending Home…" : "Confirm Send Home"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {completed ? (
        <output>Access ended until the next Office Day.</output>
      ) : null}
    </div>
  );
}
