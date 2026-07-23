"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGE_REMOVAL_PRIVATE_REASON_MAX_LENGTH } from "@/lib/message-removals/contract";
import { OperatorAccessContext } from "@/lib/operators/client";

export function MessageRemovalControls({
  onRemove,
  returnFocusRef,
  children,
}: {
  onRemove(privateReason: string): Promise<void>;
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  children?: (menuItem: ReactNode) => ReactNode;
}) {
  const hasOperatorAccess = useContext(OperatorAccessContext);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [privateReason, setPrivateReason] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const instanceId = useId();
  const titleId = `message-removal-title-${instanceId}`;
  const descriptionId = `message-removal-description-${instanceId}`;
  const reasonId = `message-removal-reason-${instanceId}`;

  useEffect(() => {
    if (dialogOpen) reasonRef.current?.focus();
  }, [dialogOpen]);

  function closeDialog(): void {
    setDialogOpen(false);
    requestAnimationFrame(() =>
      (returnFocusRef ?? triggerRef).current?.focus(),
    );
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    event.stopPropagation();
    if (event.key === "Escape") {
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

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const reason = privateReason.trim();
    if (!reason) return;
    setDialogOpen(false);
    void onRemove(reason);
  }

  function openDialog(): void {
    setPrivateReason("");
    setDialogOpen(true);
  }

  const trigger = hasOperatorAccess ? (
    children ? (
      <DropdownMenuItem onClick={openDialog} variant="destructive">
        Remove message
      </DropdownMenuItem>
    ) : (
      <button
        aria-haspopup="dialog"
        className="message-action-button message-removal-trigger"
        onClick={openDialog}
        ref={triggerRef}
        type="button"
      >
        Remove message
      </button>
    )
  ) : null;

  return (
    <>
      {children ? children(trigger) : trigger}
      {dialogOpen
        ? createPortal(
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
                <div className="hr-report-dialog-actions">
                  <Button onClick={closeDialog} type="button">
                    Cancel
                  </Button>
                  <Button
                    disabled={privateReason.trim().length === 0}
                    type="submit"
                    variant="destructive"
                  >
                    Confirm removal
                  </Button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
