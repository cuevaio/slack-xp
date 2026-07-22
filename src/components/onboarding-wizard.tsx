"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type FormEventHandler, useState } from "react";
import {
  EmployeeRecordEditor,
  type EmployeeRecordResult,
} from "@/components/employee-record-editor";
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
        setError(result.message ?? "New Employee Setup could not be saved.");
        return;
      }
      setOnboarding(result);
      if (result.step === "complete") {
        router.refresh();
      }
    } catch {
      setError("New Employee Setup is temporarily unavailable. Please retry.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="onboarding-shell">
      {isMock ? (
        <output className="mock-watermark">MOCK SERVICES - NO LIVE DATA</output>
      ) : null}
      <section className="setup-window" aria-labelledby="setup-title">
        <header className="window-titlebar">
          <span>New Employee Setup Wizard</span>
          <span aria-hidden="true">? ×</span>
        </header>
        <div className="setup-body">
          <aside className="setup-sidebar" aria-hidden="true">
            <span className="setup-brand-word">PORTAL</span>
            <strong className="setup-brand-word">SYSTEMS</strong>
            <div className="setup-orb">P</div>
          </aside>
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
      footer={<Assignment jobTitle={onboarding.jobTitle} />}
      headingId="setup-title"
      initialRecord={onboarding}
      onProjected={onProfileProjected}
    />
  );
}

function ConductStepForm({
  onboarding,
  error,
  pending,
  onSubmit,
}: StepFormProps) {
  return (
    <form onSubmit={onSubmit}>
      <input name="intent" type="hidden" value="accept-conduct" />
      <h1 id="setup-title">Review the Code of Conduct</h1>
      <p>
        The Shared Public Office is public. Keep it welcoming and remember that
        a punchline is never more important than a person.
      </p>
      <ul className="conduct-list">
        <li>Be respectful; harassment and hate are not office supplies.</li>
        <li>Share no secrets, credentials, or private information.</li>
        <li>Use HR Reports for content that needs Operator review.</li>
      </ul>
      <label className="conduct-acceptance">
        <input name="accepted" required type="checkbox" value="yes" />I have
        read and agree to follow the Code of Conduct.
      </label>
      <Assignment jobTitle={onboarding.jobTitle} />
      <WizardError message={error} />
      <button className="classic-button" disabled={pending} type="submit">
        {pending ? "Recording..." : "Accept and Continue"}
      </button>
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
      <p>
        Employee Record confirmed. Conduct accepted. One final, legally
        meaningless workplace ritual remains.
      </p>
      <Assignment jobTitle={onboarding.jobTitle} />
      <WizardError message={error} />
      <button className="clock-in-button" disabled={pending} type="submit">
        {pending ? "CLOCKING IN..." : "CLOCK IN"}
      </button>
    </form>
  );
}

function Assignment({ jobTitle }: { jobTitle: string }) {
  return (
    <div className="assignment-card">
      <span className="assignment-label">Your permanent assignment</span>
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
