"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  EmployeeRecordEditor,
  type EmployeeRecordResult,
} from "@/components/employee-record-editor";
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

  function open() {
    setSaved(false);
    dialogRef.current?.showModal();
    window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
  }

  function close() {
    dialogRef.current?.close();
  }

  function handleClose() {
    if (saved) router.refresh();
    triggerRef.current?.focus();
  }

  function handleProjected(_result: EmployeeRecordResult) {
    setSaved(true);
  }

  return (
    <>
      <button
        className="classic-button employee-record-trigger"
        onClick={open}
        ref={triggerRef}
        type="button"
      >
        Employee Record
      </button>
      <dialog
        aria-labelledby="employee-record-dialog-title"
        className="employee-record-dialog"
        onClose={handleClose}
        ref={dialogRef}
      >
        <header className="window-titlebar">
          <span>Employee Record</span>
          <button
            aria-label="Close Employee Record"
            onClick={close}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="employee-record-dialog-body">
          <EmployeeRecordEditor
            headingId="employee-record-dialog-title"
            initialRecord={onboarding}
            onProjected={handleProjected}
          />
          {saved ? (
            <button className="classic-button" onClick={close} type="button">
              Done
            </button>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
