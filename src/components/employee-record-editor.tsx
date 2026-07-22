"use client";

import Image from "next/image";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";
import type { ProfileConvergence } from "@/lib/profiles/edit";

type EditableRecord = Pick<
  OnboardingSnapshot,
  "firstName" | "lastName" | "displayName" | "imageUrl"
>;

export type EmployeeRecordResult = {
  record: EditableRecord;
  convergence: ProfileConvergence;
  onboarding: OnboardingSnapshot | null;
};

type FieldErrors = Partial<Record<"firstName" | "lastName" | "image", string>>;
type EditorState = "idle" | "saving" | "awaiting" | "success" | "error";

const EDITABLE_FIELDS = ["firstName", "lastName", "image"] as const;
const EMPLOYEE_RECORD_UNAVAILABLE =
  "Employee Record changes are temporarily unavailable.";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isEditableRecord(value: unknown): value is EditableRecord {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.firstName === "string" &&
    typeof value.lastName === "string" &&
    typeof value.displayName === "string" &&
    (value.imageUrl === null || typeof value.imageUrl === "string")
  );
}

function isOnboardingSnapshot(value: unknown): value is OnboardingSnapshot {
  if (!isObject(value)) {
    return false;
  }

  const hasValidStep =
    value.step === "profile" ||
    value.step === "conduct" ||
    value.step === "clock-in" ||
    value.step === "complete";
  const hasValidTimestamps =
    (value.profileConfirmedAt === null ||
      typeof value.profileConfirmedAt === "string") &&
    (value.conductAcceptedAt === null ||
      typeof value.conductAcceptedAt === "string") &&
    (value.completedAt === null || typeof value.completedAt === "string");

  return (
    typeof value.clerkUserId === "string" &&
    typeof value.jobTitle === "string" &&
    hasValidStep &&
    hasValidTimestamps &&
    isEditableRecord(value)
  );
}

function isEmployeeRecordResult(value: unknown): value is EmployeeRecordResult {
  if (!isObject(value)) {
    return false;
  }

  const hasValidConvergence =
    value.convergence === "awaiting_projection" ||
    value.convergence === "projected";
  const hasValidOnboarding =
    value.onboarding === null || isOnboardingSnapshot(value.onboarding);

  return (
    hasValidConvergence && isEditableRecord(value.record) && hasValidOnboarding
  );
}

function readFailure(value: unknown): {
  code: string;
  message: string;
  fieldErrors: FieldErrors;
} {
  if (!isObject(value)) {
    return {
      code: "unknown",
      message: EMPLOYEE_RECORD_UNAVAILABLE,
      fieldErrors: {},
    };
  }

  const suppliedErrors = isObject(value.fieldErrors) ? value.fieldErrors : {};
  const fieldErrors: FieldErrors = {};
  for (const field of EDITABLE_FIELDS) {
    if (typeof suppliedErrors[field] === "string") {
      fieldErrors[field] = suppliedErrors[field];
    }
  }

  return {
    code: typeof value.error === "string" ? value.error : "unknown",
    message:
      typeof value.message === "string"
        ? value.message
        : EMPLOYEE_RECORD_UNAVAILABLE,
    fieldErrors,
  };
}

function submitButtonLabel(state: EditorState): string {
  switch (state) {
    case "saving":
      return "Saving with Clerk...";
    case "error":
      return "Retry Employee Record";
    case "idle":
    case "awaiting":
    case "success":
      return "Save Employee Record";
  }
}

export function EmployeeRecordEditor({
  initialRecord,
  headingId,
  onProjected,
  footer,
  advanceAfterSuccess = false,
}: {
  initialRecord: EditableRecord;
  headingId: string;
  onProjected(result: EmployeeRecordResult): void;
  footer?: ReactNode;
  advanceAfterSuccess?: boolean;
}) {
  const [record, setRecord] = useState(initialRecord);
  const [state, setState] = useState<EditorState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const firstNameRef = useRef<HTMLInputElement>(null);
  const lastNameRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (state === "error" && Object.keys(fieldErrors).length === 0) {
      statusRef.current?.focus();
    }
  }, [fieldErrors, state]);

  function announceProjected(result: EmployeeRecordResult) {
    setRecord(result.record);
    setState("success");
    setMessage(
      "Employee Record updated in Clerk and the Shared Public Office.",
    );
    if (advanceAfterSuccess) {
      window.setTimeout(() => onProjected(result), 500);
    } else {
      onProjected(result);
    }
  }

  async function checkProjection(attempts = 1): Promise<void> {
    setState("awaiting");
    setMessage(
      "Clerk saved the changes. The Shared Public Office is updating now.",
    );
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
      try {
        const response = await fetch("/api/office/employee-record", {
          cache: "no-store",
          credentials: "include",
        });
        const payload: unknown = await response.json().catch(() => null);
        if (
          response.ok &&
          isEmployeeRecordResult(payload) &&
          payload.convergence === "projected"
        ) {
          announceProjected(payload);
          return;
        }
      } catch {
        // A later attempt may still observe the verified webhook or repair.
      }
    }
    setState("awaiting");
    setMessage(
      "Clerk saved the changes, but office confirmation is taking longer than expected. Check again shortly.",
    );
  }

  function focusFirstError(errors: FieldErrors) {
    let target: HTMLInputElement | null = null;
    if (errors.firstName) {
      target = firstNameRef.current;
    } else if (errors.lastName) {
      target = lastNameRef.current;
    } else if (errors.image) {
      target = imageRef.current;
    }
    window.setTimeout(() => target?.focus());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldErrors({});
    setMessage(null);
    setState("saving");

    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch("/api/office/employee-record", {
        method: "POST",
        credentials: "include",
        body: new FormData(event.currentTarget),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const failure = readFailure(payload);
        if (failure.code === "profile_projection_unavailable") {
          await checkProjection();
          return;
        }
        setFieldErrors(failure.fieldErrors);
        setMessage(failure.message);
        setState("error");
        focusFirstError(failure.fieldErrors);
        return;
      }
      if (!isEmployeeRecordResult(payload)) {
        throw new Error("Invalid Employee Record response");
      }
      if (payload.convergence === "projected") {
        announceProjected(payload);
      } else {
        setRecord(payload.record);
        await checkProjection(12);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage(
          "Clerk did not confirm the update in time. Your entries are still here and ready to retry.",
        );
      } else {
        setMessage(
          "Employee Record changes are temporarily unavailable. Your entries are still here and ready to retry.",
        );
      }
      setState("error");
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }

  const busy = state === "saving";

  return (
    <form aria-busy={busy} className="employee-record-form" onSubmit={submit}>
      <h1 id={headingId}>Confirm your Employee Record</h1>
      <p>
        Your public name and picture live in Clerk. Changes are saved there
        first, then projected into the Shared Public Office.
      </p>
      <div className="profile-preview">
        {record.imageUrl ? (
          <Image
            alt={`${record.displayName}'s current profile`}
            className="profile-preview-image"
            height={52}
            src={record.imageUrl}
            unoptimized
            width={52}
          />
        ) : (
          <span aria-hidden="true" className="profile-preview-placeholder">
            {record.firstName.slice(0, 1)}
            {record.lastName.slice(0, 1)}
          </span>
        )}
        <p>
          <strong>{record.displayName}</strong>
          <small>Current confirmed profile</small>
        </p>
      </div>
      <div className="profile-fields">
        <label>
          First name
          <input
            aria-describedby={
              fieldErrors.firstName ? "employee-first-name-error" : undefined
            }
            aria-invalid={fieldErrors.firstName ? true : undefined}
            autoComplete="given-name"
            defaultValue={record.firstName}
            maxLength={80}
            name="firstName"
            ref={firstNameRef}
            required
          />
          {fieldErrors.firstName ? (
            <span className="field-error" id="employee-first-name-error">
              {fieldErrors.firstName}
            </span>
          ) : null}
        </label>
        <label>
          Last name
          <input
            aria-describedby={
              fieldErrors.lastName ? "employee-last-name-error" : undefined
            }
            aria-invalid={fieldErrors.lastName ? true : undefined}
            autoComplete="family-name"
            defaultValue={record.lastName}
            maxLength={80}
            name="lastName"
            ref={lastNameRef}
          />
          {fieldErrors.lastName ? (
            <span className="field-error" id="employee-last-name-error">
              {fieldErrors.lastName}
            </span>
          ) : null}
        </label>
        <label>
          Profile picture (optional, 2 MB maximum)
          <input
            accept="image/png,image/jpeg,image/webp"
            aria-describedby={
              fieldErrors.image ? "employee-image-error" : undefined
            }
            aria-invalid={fieldErrors.image ? true : undefined}
            name="image"
            ref={imageRef}
            type="file"
          />
          {fieldErrors.image ? (
            <span className="field-error" id="employee-image-error">
              {fieldErrors.image}
            </span>
          ) : null}
        </label>
      </div>
      {footer}
      <div className="employee-record-actions">
        <button className="classic-button" disabled={busy} type="submit">
          {submitButtonLabel(state)}
        </button>
        {state === "awaiting" ? (
          <button
            className="classic-button"
            onClick={() => void checkProjection(4)}
            type="button"
          >
            Check office update
          </button>
        ) : null}
      </div>
      {message ? (
        <p
          className={state === "error" ? "setup-error" : "profile-status"}
          ref={statusRef}
          role={state === "error" ? "alert" : "status"}
          tabIndex={state === "error" ? -1 : undefined}
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
