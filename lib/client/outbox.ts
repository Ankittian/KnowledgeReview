"use client";

/**
 * Durable client outbox: every review/event is written to localStorage first, then POSTed.
 * Retries with backoff on network/5xx errors; idempotent on the server via client_event_id.
 * Events are batched into one request.
 */

interface Job {
  id: string;
  url: string;
  body: unknown;
  tries: number;
  next: number;
}

const KEY = "kr_outbox_v1";
const EVENTS_URL = "/api/events";
let jobs: Job[] | null = null;
let flushing = false;
let started = false;
const listeners = new Set<(pending: number) => void>();

function load(): Job[] {
  if (jobs) return jobs;
  try {
    jobs = JSON.parse(localStorage.getItem(KEY) ?? "[]") as Job[];
    if (!Array.isArray(jobs)) jobs = [];
  } catch {
    jobs = [];
  }
  return jobs;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(jobs ?? []));
  } catch {
    /* storage full / blocked: jobs stay in memory */
  }
  listeners.forEach((l) => l(jobs?.length ?? 0));
}

export function uid(): string {
  try {
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* insecure context (plain http on a LAN IP) */
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function enqueue(url: string, body: { clientEventId: string } & Record<string, unknown>) {
  load().push({ id: body.clientEventId, url, body, tries: 0, next: 0 });
  save();
  void flush();
}

export function trackEvent(type: string, versionId?: number | null, payload?: Record<string, unknown>) {
  const clientEventId = uid();
  enqueue(EVENTS_URL, { clientEventId, type, versionId: versionId ?? null, at: new Date().toISOString(), payload: payload ?? {} });
}

type Outcome = "done" | "retry" | "auth";

async function post(url: string, body: unknown, keepalive = false): Promise<Outcome> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      keepalive,
    });
    if (res.ok) return "done";
    if (res.status === 401) return "auth";
    if (res.status === 408 || res.status === 429 || res.status >= 500) return "retry";
    return "done"; // 400/404/409: permanent, drop it
  } catch {
    return "retry";
  }
}

function settle(batch: Job[], outcome: Outcome) {
  const list = load();
  if (outcome === "done") {
    const ids = new Set(batch.map((j) => j.id));
    jobs = list.filter((j) => !ids.has(j.id));
    return;
  }
  for (const j of batch) {
    j.tries++;
    j.next = Date.now() + Math.min(60_000, 1000 * 2 ** j.tries);
  }
}

export async function flush(keepalive = false): Promise<void> {
  if (flushing || typeof window === "undefined") return;
  if (navigator.onLine === false) return;
  flushing = true;
  try {
    const now = Date.now();
    // reviews first (they matter most), one by one, in order
    for (const j of load().filter((x) => x.url !== EVENTS_URL && x.next <= now)) {
      const o = await post(j.url, j.body, keepalive);
      settle([j], o);
      if (o !== "done") break;
    }
    const evs = load().filter((x) => x.url === EVENTS_URL && x.next <= now).slice(0, 100);
    if (evs.length) settle(evs, await post(EVENTS_URL, { events: evs.map((e) => e.body) }, keepalive));
  } finally {
    flushing = false;
    save();
  }
}

export function startOutbox() {
  if (started || typeof window === "undefined") return;
  started = true;
  load();
  window.addEventListener("online", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
  window.setInterval(() => void flush(), 10_000);
  void flush();
}

export function onPendingChange(fn: (pending: number) => void): () => void {
  listeners.add(fn);
  fn(load().length);
  return () => listeners.delete(fn);
}

export function deviceInfo(): string {
  if (typeof window === "undefined") return "unknown";
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const w = window.innerWidth;
  return `${coarse ? "touch" : "mouse"}-${w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop"}`;
}
