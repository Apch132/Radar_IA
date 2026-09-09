export type SchedulerTimerHandle = { clear(): void };

export type SchedulerClock = {
  now(): number;
};

export type SchedulerTimers = {
  setTimeout(handler: () => void, ms: number): SchedulerTimerHandle;
};

export type CycleSchedulerOptions = {
  /** Delay before the first cycle (ms). */
  readonly initialDelayMs: number;
  /** Delay after a cycle finishes before the next tick (ms). */
  readonly intervalMs: number;
  /** When false, run at most one cycle (one-shot). */
  readonly schedulerEnabled: boolean;
  readonly runCycle: () => Promise<void>;
  readonly onError?: (error: unknown) => void;
  readonly clock?: SchedulerClock;
  readonly timers?: SchedulerTimers;
};

export interface CycleScheduler {
  /** Arm the first cycle; idempotent while already started. */
  start(): void;
  /** Stop scheduling further cycles; does not cancel an in-flight cycle. */
  stop(): void;
  readonly isTickActive: boolean;
  readonly isStopped: boolean;
}

function defaultTimers(): SchedulerTimers {
  return {
    setTimeout(handler, ms) {
      const id = setTimeout(handler, ms);
      return {
        clear() {
          clearTimeout(id);
        },
      };
    },
  };
}

/**
 * Minimal cycle scheduler: at most one local tick, no catch-up burst,
 * injectable timers for tests. PostgreSQL single-flight remains authoritative.
 */
export function createCycleScheduler(
  options: CycleSchedulerOptions,
): CycleScheduler {
  const timers = options.timers ?? defaultTimers();
  let pending: SchedulerTimerHandle | undefined;
  let tickActive = false;
  let stopped = true;
  let started = false;

  function clearPending(): void {
    if (pending !== undefined) {
      pending.clear();
      pending = undefined;
    }
  }

  function schedule(delayMs: number): void {
    clearPending();
    if (stopped) {
      return;
    }
    pending = timers.setTimeout(() => {
      pending = undefined;
      void runTick();
    }, delayMs);
  }

  async function runTick(): Promise<void> {
    if (stopped || tickActive) {
      return;
    }
    tickActive = true;
    try {
      await options.runCycle();
    } catch (error) {
      options.onError?.(error);
    } finally {
      tickActive = false;
      if (!stopped && options.schedulerEnabled) {
        schedule(options.intervalMs);
      } else {
        stopped = true;
      }
    }
  }

  return {
    start() {
      if (started && !stopped) {
        return;
      }
      started = true;
      stopped = false;
      schedule(options.initialDelayMs);
    },
    stop() {
      stopped = true;
      clearPending();
    },
    get isTickActive() {
      return tickActive;
    },
    get isStopped() {
      return stopped;
    },
  };
}
