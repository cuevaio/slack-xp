"use client";

import Image from "next/image";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
const PROFILE_UNAVAILABLE = "We couldn't save your profile. Please try again.";

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
      message: PROFILE_UNAVAILABLE,
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
    message: PROFILE_UNAVAILABLE,
    fieldErrors,
  };
}

function submitButtonLabel(state: EditorState): string {
  switch (state) {
    case "saving":
      return "Saving...";
    case "error":
      return "Try again";
    case "idle":
    case "awaiting":
    case "success":
      return "Save profile";
  }
}

export function EmployeeRecordEditor({
  initialRecord,
  headingId,
  onProjected,
  advanceAfterSuccess = false,
}: {
  initialRecord: EditableRecord;
  headingId: string;
  onProjected(result: EmployeeRecordResult): void;
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
    setMessage("Profile updated.");
    if (advanceAfterSuccess) {
      window.setTimeout(() => onProjected(result), 500);
    } else {
      onProjected(result);
    }
  }

  async function checkProjection(attempts = 1): Promise<void> {
    setState("awaiting");
    setMessage("Your profile is still updating.");
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
    setMessage("Your profile is taking longer than expected to update.");
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
          "Saving took too long. Your entries are ready to try again.",
        );
      } else {
        setMessage(
          "We couldn't save your profile. Your entries are ready to try again.",
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
      <h1 id={headingId}>Choose your name and picture</h1>
      <p>This is how other New Hires will see you in the office.</p>
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
        </p>
      </div>
      <div className="profile-fields">
        <Label htmlFor="employee-first-name">
          First name
          <Input
            aria-describedby={
              fieldErrors.firstName ? "employee-first-name-error" : undefined
            }
            aria-invalid={fieldErrors.firstName ? true : undefined}
            autoComplete="given-name"
            defaultValue={record.firstName}
            id="employee-first-name"
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
        </Label>
        <Label htmlFor="employee-last-name">
          Last name
          <Input
            aria-describedby={
              fieldErrors.lastName ? "employee-last-name-error" : undefined
            }
            aria-invalid={fieldErrors.lastName ? true : undefined}
            autoComplete="family-name"
            defaultValue={record.lastName}
            id="employee-last-name"
            maxLength={80}
            name="lastName"
            ref={lastNameRef}
          />
          {fieldErrors.lastName ? (
            <span className="field-error" id="employee-last-name-error">
              {fieldErrors.lastName}
            </span>
          ) : null}
        </Label>
        <Label htmlFor="employee-image">
          Profile picture (optional)
          <Input
            accept="image/png,image/jpeg,image/webp"
            aria-describedby={
              fieldErrors.image ? "employee-image-error" : undefined
            }
            aria-invalid={fieldErrors.image ? true : undefined}
            id="employee-image"
            name="image"
            ref={imageRef}
            type="file"
          />
          {fieldErrors.image ? (
            <span className="field-error" id="employee-image-error">
              {fieldErrors.image}
            </span>
          ) : null}
        </Label>
      </div>
      <div className="employee-record-actions">
        <Button disabled={busy} type="submit">
          {submitButtonLabel(state)}
        </Button>
        {state === "awaiting" ? (
          <Button onClick={() => void checkProjection(4)} type="button">
            Check again
          </Button>
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
