/**
 * First-in, first-out slot limiter (REQ-HARN-07): at most `limit` answers run at once, the rest wait in order and are
 * told their position (REQ-CHAT-11). Process-wide: one instance is shared by every request in this Node process.
 */
export interface QueueTicket {
  /** Resolves when a slot is granted. Rejects with an AbortError if cancelled while waiting. */
  ready: Promise<void>;
  /** Give the slot back (idempotent). Must be called once the work is finished. */
  release: () => void;
  /** 0 = running; 1 = next in line; and so on. */
  position: () => number;
}

interface Waiter {
  grant: () => void;
  onPosition?: (pos: number) => void;
}

export class SlotQueue {
  private running = 0;
  private waiters: Waiter[] = [];

  constructor(private limitFn: () => number) {}

  get stats() {
    return { running: this.running, waiting: this.waiters.length, limit: this.limitFn() };
  }

  acquire(opts: { signal?: AbortSignal; onPosition?: (pos: number) => void } = {}): QueueTicket {
    let granted = false;
    let released = false;
    let waiter: Waiter | null = null;

    const release = () => {
      if (released) return;
      released = true;
      if (granted) {
        this.running--;
        this.pump();
      } else if (waiter) {
        this.remove(waiter);
      }
    };

    const ready = new Promise<void>((resolve, reject) => {
      const grant = () => {
        granted = true;
        this.running++;
        opts.onPosition?.(0);
        resolve();
      };
      if (opts.signal?.aborted) return reject(abortError());
      if (this.running < this.limitFn() && this.waiters.length === 0) return grant();
      waiter = { grant, onPosition: opts.onPosition };
      this.waiters.push(waiter);
      opts.onPosition?.(this.waiters.length);
      opts.signal?.addEventListener(
        "abort",
        () => {
          if (granted || released) return;
          released = true;
          this.remove(waiter!);
          reject(abortError());
        },
        { once: true },
      );
    });

    return {
      ready,
      release,
      position: () => (granted ? 0 : waiter ? this.waiters.indexOf(waiter) + 1 : 0),
    };
  }

  private remove(w: Waiter) {
    const i = this.waiters.indexOf(w);
    if (i >= 0) {
      this.waiters.splice(i, 1);
      this.notifyPositions();
    }
  }

  private pump() {
    while (this.running < this.limitFn() && this.waiters.length) {
      const next = this.waiters.shift()!;
      next.grant();
    }
    this.notifyPositions();
  }

  private notifyPositions() {
    this.waiters.forEach((w, i) => w.onPosition?.(i + 1));
  }
}

function abortError() {
  const e = new Error("Cancelled while waiting in the queue");
  e.name = "AbortError";
  return e;
}
