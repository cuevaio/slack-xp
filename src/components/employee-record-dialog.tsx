"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { EmployeeRecordEditor } from "@/components/employee-record-editor";
import { Button } from "@/components/ui/button";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";

export function EmployeeRecordDialog({
  onboarding,
}: {
  onboarding: OnboardingSnapshot;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  function openDialog() {
    setSaved(false);
    dialogRef.current?.showModal();
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function handleClose() {
    if (saved) router.refresh();
    triggerRef.current?.focus();
  }

  function handleProjected() {
    setSaved(true);
  }

  return (
    <>
      <Button
        className="employee-record-trigger"
        onClick={openDialog}
        ref={triggerRef}
        type="button"
      >
        Employee Record
      </Button>
      <dialog
        aria-labelledby="employee-record-dialog-title"
        className="employee-record-dialog"
        onClose={handleClose}
        ref={dialogRef}
      >
        <header className="window-titlebar">
          <span>Employee Record</span>
          <Button
            aria-label="Close Employee Record"
            onClick={closeDialog}
            size="icon-sm"
            type="button"
          >
            ×
          </Button>
        </header>
        <div className="employee-record-dialog-body">
          <EmployeeRecordEditor
            headingId="employee-record-dialog-title"
            initialRecord={onboarding}
            onProjected={handleProjected}
          />
          {saved ? (
            <Button onClick={closeDialog} type="button">
              Done
            </Button>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
