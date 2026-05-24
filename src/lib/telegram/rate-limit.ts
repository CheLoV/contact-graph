// Rate-limit + flood-wait protection for Telegram MTProto calls.
//
// Three tiers (see CLAUDE.md «Telegram API import logic»):
//   1. Per-call retry — flood-wait ≤ HARD_CAP_SECONDS: sleep N+1, retry, up to MAX_RETRIES.
//   2. Per-call hard cap — flood-wait > HARD_CAP_SECONDS: re-throw, no sleep.
//      Telegram is asking us to stop; not our job to ignore.
//   3. Job-level cumulative — sum of all waits > CUMULATIVE_LIMIT_MS: abort
//      via callback so caller can stop the import gracefully.
//
// Local throttle: never more than REQUESTS_PER_SECOND in a sliding 1-second
// window. Implemented as a simple in-memory deque.

const REQUESTS_PER_SECOND = 25;
const MAX_RETRIES = 3;
const HARD_CAP_SECONDS = 300;

// Cumulative job-level flood-wait budget. Overridable via TELEGRAM_FLOOD_LIMIT_SEC
// env (default: 30 minutes). Long Day 3-A imports may need 60-90 minutes.
function readCumulativeLimitMs(): number {
  const raw = process.env.TELEGRAM_FLOOD_LIMIT_SEC;
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }
  return 30 * 60 * 1000;
}
const CUMULATIVE_LIMIT_MS = readCumulativeLimitMs();

const recentRequestTimes: number[] = [];
let cumulativeWaitMs = 0;
let abortedCumulative = false;

export type RateLimitedError =
  | { kind: "hard_cap_exceeded"; seconds: number }
  | { kind: "cumulative_limit_exceeded"; totalMs: number }
  | { kind: "max_retries_exceeded"; lastError: unknown };

export class RateLimitError extends Error {
  detail: RateLimitedError;
  constructor(detail: RateLimitedError, message: string) {
    super(message);
    this.detail = detail;
    this.name = "RateLimitError";
  }
}

export function resetRateLimiterState(): void {
  recentRequestTimes.length = 0;
  cumulativeWaitMs = 0;
  abortedCumulative = false;
}

export function getCumulativeWaitMs(): number {
  return cumulativeWaitMs;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function throttle(): Promise<void> {
  const now = Date.now();
  while (recentRequestTimes.length > 0) {
    const first = recentRequestTimes[0];
    if (first === undefined || first >= now - 1000) break;
    recentRequestTimes.shift();
  }
  if (recentRequestTimes.length >= REQUESTS_PER_SECOND) {
    const oldest = recentRequestTimes[0];
    if (oldest !== undefined) {
      const sleepMs = oldest + 1000 - now;
      if (sleepMs > 0) await sleep(sleepMs);
    }
  }
  recentRequestTimes.push(Date.now());
}

function extractFloodWaitSeconds(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { seconds?: unknown; className?: unknown; errorMessage?: unknown };
  if (e.className === "FloodWaitError" && typeof e.seconds === "number") {
    return e.seconds;
  }
  if (typeof e.errorMessage === "string") {
    const m = e.errorMessage.match(/^FLOOD_WAIT_(\d+)$/);
    if (m && m[1]) return Number(m[1]);
  }
  return null;
}

export async function withRateLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (abortedCumulative) {
    throw new RateLimitError(
      { kind: "cumulative_limit_exceeded", totalMs: cumulativeWaitMs },
      `Cumulative flood-wait already exceeded ${CUMULATIVE_LIMIT_MS / 1000}s — aborting`,
    );
  }

  await throttle();

  let lastError: unknown = undefined;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const seconds = extractFloodWaitSeconds(err);
      if (seconds === null) throw err;
      if (seconds > HARD_CAP_SECONDS) {
        throw new RateLimitError(
          { kind: "hard_cap_exceeded", seconds },
          `FloodWait ${seconds}s exceeds hard cap ${HARD_CAP_SECONDS}s`,
        );
      }
      const waitMs = (seconds + 1) * 1000;
      cumulativeWaitMs += waitMs;
      if (cumulativeWaitMs > CUMULATIVE_LIMIT_MS) {
        abortedCumulative = true;
        throw new RateLimitError(
          { kind: "cumulative_limit_exceeded", totalMs: cumulativeWaitMs },
          `Cumulative flood-wait ${cumulativeWaitMs}ms exceeded ${CUMULATIVE_LIMIT_MS}ms`,
        );
      }
      console.warn(
        `[Telegram] Flood-wait ${seconds}s on attempt ${attempt + 1}/${MAX_RETRIES} ` +
          `(cumulative ${Math.round(cumulativeWaitMs / 1000)}s) — sleeping`,
      );
      await sleep(waitMs);
    }
  }
  throw new RateLimitError(
    { kind: "max_retries_exceeded", lastError },
    `Max retries (${MAX_RETRIES}) exceeded`,
  );
}
