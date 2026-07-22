"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type FormEventHandler, useState } from "react";
import {
  EmployeeRecordEditor,
  type EmployeeRecordResult,
} from "@/components/employee-record-editor";
import { Button } from "@/components/ui/button";
import type { OnboardingSnapshot } from "@/lib/onboarding/types";

const stepNumber = {
  profile: 1,
  conduct: 2,
  "clock-in": 3,
  complete: 3,
} as const;

export function OnboardingWizard({
  initialOnboarding,
  isMock,
}: {
  initialOnboarding: OnboardingSnapshot;
  isMock: boolean;
}) {
  const router = useRouter();
  const [onboarding, setOnboarding] = useState(initialOnboarding);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/office/onboarding", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.message ?? "Your setup could not be saved.");
        return;
      }
      setOnboarding(result);
      if (result.step === "complete") {
        router.refresh();
      }
    } catch {
      setError("Setup is temporarily unavailable. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="onboarding-shell">
      {isMock ? (
        <output className="mock-watermark">Development mode</output>
      ) : null}
      <section className="setup-window" aria-labelledby="setup-title">
        <header className="window-titlebar">
          <span>New Hire Setup</span>
        </header>
        <div className="setup-body">
          <div className="setup-content">
            <p className="setup-progress">
              Step {stepNumber[onboarding.step]} of 3
            </p>
            <OnboardingStepForm
              error={error}
              onboarding={onboarding}
              onProfileProjected={(result) => {
                if (result.onboarding) setOnboarding(result.onboarding);
              }}
              onSubmit={submit}
              pending={pending}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

type StepFormProps = {
  onboarding: OnboardingSnapshot;
  error: string | null;
  pending: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onProfileProjected: (result: EmployeeRecordResult) => void;
};

function OnboardingStepForm(props: StepFormProps) {
  switch (props.onboarding.step) {
    case "profile":
      return <ProfileStepForm {...props} />;
    case "conduct":
      return <ConductStepForm {...props} />;
    case "clock-in":
      return <ClockInStepForm {...props} />;
    case "complete":
      return null;
  }
}

function ProfileStepForm({ onboarding, onProfileProjected }: StepFormProps) {
  return (
    <EmployeeRecordEditor
      advanceAfterSuccess
      headingId="setup-title"
      initialRecord={onboarding}
      onProjected={onProfileProjected}
    />
  );
}

function ConductStepForm({ error, pending, onSubmit }: StepFormProps) {
  return (
    <form onSubmit={onSubmit}>
      <input name="intent" type="hidden" value="accept-conduct" />
      <h1 id="setup-title">Review the Code of Conduct</h1>
      <p>The Shared Public Office is public. Help keep it welcoming.</p>
      <ul className="conduct-list">
        <li>Be respectful.</li>
        <li>Do not share secrets or private information.</li>
        <li>Report anything that needs Operator review.</li>
      </ul>
      <label className="conduct-acceptance">
        <input name="accepted" required type="checkbox" value="yes" />I have
        read and agree to follow the Code of Conduct.
      </label>
      <WizardError message={error} />
      <Button disabled={pending} type="submit">
        {pending ? "Saving..." : "Accept and continue"}
      </Button>
    </form>
  );
}

function ClockInStepForm({
  onboarding,
  error,
  pending,
  onSubmit,
}: StepFormProps) {
  return (
    <form onSubmit={onSubmit}>
      <input name="intent" type="hidden" value="clock-in" />
      <h1 id="setup-title">Your desk is almost ready</h1>
      <p>You are ready to join the Shared Public Office.</p>
      <Assignment jobTitle={onboarding.jobTitle} />
      <WizardError message={error} />
      <Button
        className="clock-in-button"
        disabled={pending}
        size="lg"
        type="submit"
        variant="primary"
      >
        {pending ? "CLOCKING IN..." : "CLOCK IN"}
      </Button>
    </form>
  );
}

function Assignment({ jobTitle }: { jobTitle: string }) {
  return (
    <div className="assignment-card">
      <span className="assignment-label">Your office title</span>
      <strong>{jobTitle}</strong>
    </div>
  );
}

function WizardError({ message }: { message: string | null }) {
  return message ? (
    <p className="setup-error" role="alert">
      {message}
    </p>
  ) : null;
}
