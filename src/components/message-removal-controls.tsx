"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  type KeyboardEvent,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { invalidateHRReportQueue } from "@/lib/hr-reports/client";
import {
  messageRemovalQueryKey,
  submitMessageRemoval,
} from "@/lib/message-removals/client";
import {
  MESSAGE_REMOVAL_PRIVATE_REASON_MAX_LENGTH,
  type SerializedMessageRemovalProjection,
} from "@/lib/message-removals/contract";
import { OperatorAccessContext } from "@/lib/operators/client";
import type { SafePortalChatMessage } from "@/lib/portal/chat";

export function MessageRemovalControls({
  message,
}: {
  message: SafePortalChatMessage;
}) {
  const hasOperatorAccess = useContext(OperatorAccessContext);
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [privateReason, setPrivateReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const instanceId = useId();
  const titleId = `message-removal-title-${instanceId}`;
  const descriptionId = `message-removal-description-${instanceId}`;
  const reasonId = `message-removal-reason-${instanceId}`;

  useEffect(() => {
    if (dialogOpen) reasonRef.current?.focus();
  }, [dialogOpen]);

  if (!hasOperatorAccess) {
    return null;
  }

  function closeDialog(): void {
    if (submitting) return;
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
    setSubmitting(true);
    setError(false);
    try {
      const removal = await submitMessageRemoval({
        officeChannelId: message.channelId,
        messageId: message.id,
        privateReason,
      });
      queryClient.setQueryData<SerializedMessageRemovalProjection[]>(
        messageRemovalQueryKey(message.channelId),
        (current = []) => {
          const alreadyCached = current.some(
            ({ messageId }) => messageId === removal.messageId,
          );
          return alreadyCached ? current : [...current, removal];
        },
      );
      await invalidateHRReportQueue(queryClient);
      setDialogOpen(false);
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="message-removal-controls">
      <button
        aria-haspopup="dialog"
        className="message-action-button message-removal-trigger"
        onClick={() => {
          setPrivateReason("");
          setError(false);
          setDialogOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        Remove message
      </button>
      {dialogOpen ? (
        <div
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          aria-modal="true"
          className="hr-report-dialog-backdrop"
          onKeyDown={handleDialogKeyDown}
          role="dialog"
        >
          <form className="hr-report-dialog" onSubmit={submit}>
            <h2 id={titleId}>Remove this message?</h2>
            <p id={descriptionId}>
              This hides the message in Portal Messenger, but does not
              permanently erase it from the underlying message service.
            </p>
            <label htmlFor={reasonId}>Reason (private)</label>
            <Textarea
              id={reasonId}
              maxLength={MESSAGE_REMOVAL_PRIVATE_REASON_MAX_LENGTH}
              onChange={(event) => setPrivateReason(event.target.value)}
              ref={reasonRef}
              required
              rows={4}
              value={privateReason}
            />
            <small>Only Operators can see this reason.</small>
            {error ? (
              <p className="chat-error" role="alert">
                The message could not be removed. Please try again.
              </p>
            ) : null}
            <div className="hr-report-dialog-actions">
              <Button disabled={submitting} onClick={closeDialog} type="button">
                Cancel
              </Button>
              <Button
                disabled={submitting || privateReason.trim().length === 0}
                type="submit"
                variant="destructive"
              >
                {submitting ? "Removing…" : "Confirm removal"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
