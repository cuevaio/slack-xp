"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  fetchNewHireEmploymentState,
  requestReinstatement,
  requestTermination,
} from "@/lib/employment/client";
import { EMPLOYMENT_PRIVATE_REASON_MAX_LENGTH } from "@/lib/employment/contract";

type EmploymentAction = "terminate" | "reinstate";

const ACTION_COPY: Record<
  EmploymentAction,
  { trigger: string; title: string; description: string; confirmation: string }
> = {
  terminate: {
    trigger: "Terminate",
    title: "Terminate this New Hire?",
    description:
      "Access ends immediately and remains blocked across future Office Days until an Operator reverses it.",
    confirmation: "Confirm Termination",
  },
  reinstate: {
    trigger: "Reinstate",
    title: "Reinstate this New Hire?",
    description:
      "Persistent access denial will be removed. Any active Send Home or account-deletion restriction remains in force.",
    confirmation: "Confirm Reinstatement",
  },
};

export function TerminationControl({
  targetNewHireId,
  reportId,
  allowReinstatement = false,
  onCompleted,
}: {
  targetNewHireId: string;
  reportId?: string;
  allowReinstatement?: boolean;
  onCompleted?(): void;
}) {
  const [hasActiveTermination, setHasActiveTermination] = useState<
    boolean | null
  >(null);
  const [action, setAction] = useState<EmploymentAction | null>(null);
  const [privateReason, setPrivateReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [requestIds] = useState(() => ({
    terminate: crypto.randomUUID(),
    reinstate: crypto.randomUUID(),
  }));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const instanceId = useId();

  useEffect(() => {
    let isCurrent = true;
    void fetchNewHireEmploymentState(targetNewHireId)
      .then((state) => {
        if (isCurrent) {
          setHasActiveTermination(state.activeTermination !== null);
        }
      })
      .catch(() => {
        if (isCurrent) setHasActiveTermination(null);
      });
    return () => {
      isCurrent = false;
    };
  }, [targetNewHireId]);

  useEffect(() => {
    if (action) reasonRef.current?.focus();
  }, [action]);

  function close(): void {
    setAction(null);
    setPrivateReason("");
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
    if (!action || !reason) return;
    setSubmitting(true);
    setError(false);
    try {
      if (action === "terminate") {
        await requestTermination({
          requestId: requestIds.terminate,
          targetNewHireId,
          privateReason: reason,
          ...(reportId ? { reportId } : {}),
        });
        setHasActiveTermination(true);
      } else {
        await requestReinstatement({
          requestId: requestIds.reinstate,
          targetNewHireId,
          privateReason: reason,
        });
        setHasActiveTermination(false);
      }
      close();
      onCompleted?.();
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  const nextAction: EmploymentAction = hasActiveTermination
    ? "reinstate"
    : "terminate";
  const nextActionCopy = ACTION_COPY[nextAction];
  const selectedActionCopy = action ? ACTION_COPY[action] : null;
  if (hasActiveTermination && !allowReinstatement) {
    return <output>Active Termination</output>;
  }

  return (
    <div className="send-home-control">
      <button
        aria-haspopup="dialog"
        className="classic-button"
        disabled={hasActiveTermination === null}
        onClick={() => {
          setError(false);
          setAction(nextAction);
        }}
        ref={triggerRef}
        type="button"
      >
        {nextActionCopy.trigger}
      </button>
      {selectedActionCopy ? (
        <div
          aria-labelledby={`employment-action-title-${instanceId}`}
          aria-modal="true"
          className="hr-report-dialog-backdrop"
          onKeyDown={handleKeyDown}
          role="dialog"
        >
          <form className="hr-report-dialog" onSubmit={submit}>
            <h2 id={`employment-action-title-${instanceId}`}>
              {selectedActionCopy.title}
            </h2>
            <p>{selectedActionCopy.description}</p>
            <label htmlFor={`employment-action-reason-${instanceId}`}>
              Private Operator reason (required)
            </label>
            <textarea
              id={`employment-action-reason-${instanceId}`}
              maxLength={EMPLOYMENT_PRIVATE_REASON_MAX_LENGTH}
              onChange={(event) => setPrivateReason(event.currentTarget.value)}
              ref={reasonRef}
              required
              rows={4}
              value={privateReason}
            />
            {error ? (
              <p className="chat-error" role="alert">
                Employment action failed. Operator access was rechecked.
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
                {submitting ? "Recording…" : selectedActionCopy.confirmation}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
