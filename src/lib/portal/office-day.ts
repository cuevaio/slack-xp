const MILLISECONDS_PER_DAY = 86_400_000;
const OFFICE_DAY_RECHECK_INTERVAL = 60_000;
const OFFICE_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const OFFICE_DAY_RECOVERY_EVENTS = ["pageshow", "focus", "online"] as const;

type TimerHandle = number;

type OfficeDayBoundaryOptions = {
  currentOfficeDay: string;
  onBoundary(): void;
  now?: () => Date;
  windowTarget?: EventTarget;
  documentTarget?: EventTarget & {
    visibilityState?: DocumentVisibilityState;
  };
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
};

export function isOfficeDay(value: string): boolean {
  if (!OFFICE_DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function officeDay(now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError(
      "A valid instant is required to calculate an Office Day.",
    );
  }
  return now.toISOString().slice(0, 10);
}

export function millisecondsUntilNextOfficeDay(now: Date = new Date()): number {
  const currentOfficeDay = officeDay(now);
  const nextBoundary =
    Date.parse(`${currentOfficeDay}T00:00:00.000Z`) + MILLISECONDS_PER_DAY;
  return nextBoundary - now.getTime();
}

export function formatOfficeTimestamp(
  timestamp: number,
  timeZone?: string,
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(timestamp);
}

export function observeOfficeDayBoundary({
  currentOfficeDay,
  onBoundary,
  now = () => new Date(),
  windowTarget = window,
  documentTarget = document,
  setTimer = (callback, delay) => window.setTimeout(callback, delay),
  clearTimer = (timer) => window.clearTimeout(timer),
}: OfficeDayBoundaryOptions): () => void {
  if (!isOfficeDay(currentOfficeDay)) {
    throw new TypeError("A valid UTC Office Day is required.");
  }

  let timer: TimerHandle | undefined;
  let stopped = false;

  function cancelTimer(): void {
    if (timer !== undefined) {
      clearTimer(timer);
      timer = undefined;
    }
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    cancelTimer();
    documentTarget.removeEventListener("visibilitychange", onVisibilityChange);
    for (const eventName of OFFICE_DAY_RECOVERY_EVENTS) {
      windowTarget.removeEventListener(eventName, recheck);
    }
  }

  function recheck(): void {
    if (stopped) return;
    cancelTimer();
    const checkedAt = now();
    if (officeDay(checkedAt) !== currentOfficeDay) {
      stop();
      onBoundary();
      return;
    }
    timer = setTimer(
      recheck,
      Math.min(
        millisecondsUntilNextOfficeDay(checkedAt),
        OFFICE_DAY_RECHECK_INTERVAL,
      ),
    );
  }

  function onVisibilityChange(): void {
    if (documentTarget.visibilityState !== "hidden") {
      recheck();
    }
  }

  documentTarget.addEventListener("visibilitychange", onVisibilityChange);
  for (const eventName of OFFICE_DAY_RECOVERY_EVENTS) {
    windowTarget.addEventListener(eventName, recheck);
  }
  recheck();

  return stop;
}
