import { describe, expect, it, vi } from "vitest";
import {
  blockedCategoryOf,
  buildState,
  checkSetFor,
  classifyIntent,
  intentConfig,
  intentEnabled,
  questionsFor,
  REFUSALS,
  type IntentConfig,
  type IntentInput,
} from "@/lib/chat/intent";
import { callJev, JevError } from "@/lib/chat/intent/jev";

const cfg = (over: Partial<IntentConfig> = {}): IntentConfig => ({ ...intentConfig({ CLASSIFIER_ENABLED: "true", CLASSIFIER_API_KEY: "sk-test", CLASSIFIER_MODE: "enforce" }), ...over });
const input = (over: Partial<IntentInput> = {}): IntentInput => ({ tokenRole: "technical", isAdmin: false, latestQuestion: "What is a GRN?", previousQuestions: [], ...over });

const answers = (p: Record<string, number>) => ({ model: "jev-1.14.0", answers: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { type: "noul", noul: v }])), usage: { input_tokens: 1, output_tokens: 1 } });
const ok = (p: Record<string, number>) => new Response(JSON.stringify(answers(p)), { status: 200, headers: { "content-type": "application/json" } });
const low = { is_sql_injection: 0.01, is_jailbreak: 0.02, is_out_of_domain: 0.03 };
const mockFetch = (...rs: Array<Response | Error | (() => Promise<Response>)>) => {
  const f = vi.fn(async (..._a: Parameters<typeof fetch>) => {
    const r = rs.shift() ?? rs[0];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r() : r;
  });
  return f as typeof f & typeof fetch;
};
const bodyOf = (f: ReturnType<typeof mockFetch>, call = 0) => JSON.parse(String(f.mock.calls[call][1]?.body));

describe("intentConfig", () => {
  it("defaults to disabled shadow mode", () => {
    expect(intentConfig({})).toEqual({
      enabled: false,
      mode: "shadow",
      timeoutMs: 3000,
      apiKey: "",
      model: "jev-1.14.0",
      baseUrl: "https://api.typesafe.ai/v1/systemone",
      thresholds: { sql_injection: 0.5, jailbreak: 0.5, out_of_domain: 0.5, restricted_object: 0.5 },
    });
  });
  it("reads the env", () => {
    const c = intentConfig({ CLASSIFIER_ENABLED: "true", CLASSIFIER_MODE: "enforce", CLASSIFIER_TIMEOUT_MS: "1500", CLASSIFIER_API_KEY: " k ", CLASSIFIER_MODEL: "jev-x", CLASSIFIER_BASE_URL: "http://x/y", CLASSIFIER_THRESHOLDS: '{"jailbreak":0.2,"restricted_object":7,"sql_injection":-1,"bogus":0.9,"out_of_domain":"high"}' });
    expect(c).toMatchObject({ enabled: true, mode: "enforce", timeoutMs: 1500, apiKey: "k", model: "jev-x", baseUrl: "http://x/y" });
    expect(c.thresholds).toEqual({ sql_injection: 0, jailbreak: 0.2, out_of_domain: 0.5, restricted_object: 1 });
  });
  it("falls back on bad values", () => {
    const c = intentConfig({ CLASSIFIER_MODE: "weird", CLASSIFIER_TIMEOUT_MS: "abc", CLASSIFIER_THRESHOLDS: "{not json" });
    expect(c.mode).toBe("shadow");
    expect(c.timeoutMs).toBe(3000);
    expect(c.thresholds.jailbreak).toBe(0.5);
  });
});

describe("check sets", () => {
  it("picks the set from token role and admin", () => {
    expect(checkSetFor("technical", false)).toBe("common");
    expect(checkSetFor("functional", false)).toBe("common+functional");
    expect(checkSetFor("functional", true)).toBe("common");
    expect(checkSetFor(null, false)).toBe("common");
  });
  it("asks one noul question per check", () => {
    expect(Object.keys(questionsFor("common"))).toEqual(["is_sql_injection", "is_jailbreak", "is_out_of_domain"]);
    expect(Object.keys(questionsFor("common+functional"))).toEqual(["is_sql_injection", "is_jailbreak", "is_out_of_domain", "asks_restricted_object"]);
    for (const q of Object.values(questionsFor("common+functional"))) expect(q.type).toBe("noul");
  });
  it("only mentions restricted objects to the functional check set", () => {
    expect(buildState(input(), "common").policy).not.toContain("RESTRICTED OBJECT");
    expect(buildState(input(), "common+functional").policy).toContain("RESTRICTED OBJECT");
    expect(buildState(input(), "common").policy).toContain("SpectrumERP");
  });
});

describe("buildState", () => {
  it("keeps only the last 2 previous questions, oldest first, and no empties", () => {
    const s = buildState({ latestQuestion: "q4", previousQuestions: ["q1", "q2", "  ", "q3"] }, "common");
    expect(s.conversation).toEqual({ previous_user_questions: ["q2", "q3"], latest_user_question: "q4" });
  });
  it("truncates latest to 4000 and previous to 1000 chars", () => {
    const s = buildState({ latestQuestion: "a".repeat(5000), previousQuestions: ["b".repeat(1500), "c".repeat(999)] }, "common");
    expect(s.conversation.latest_user_question).toHaveLength(4000);
    expect(s.conversation.previous_user_questions[0]).toHaveLength(1000);
    expect(s.conversation.previous_user_questions[1]).toHaveLength(999);
  });
  it("does not split a surrogate pair", () => {
    const s = buildState({ latestQuestion: "x".repeat(3999) + "😀", previousQuestions: [] }, "common");
    expect(s.conversation.latest_user_question).toBe("x".repeat(3999));
  });
});

describe("request shape", () => {
  it("POSTs model, state and noul questions with a bearer key", async () => {
    const f = mockFetch(ok(low));
    await classifyIntent(input({ latestQuestion: "hello", previousQuestions: ["a", "b", "c"] }), { config: cfg({ model: "jev-test", baseUrl: "https://example.test/v1/systemone" }), fetch: f });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://example.test/v1/systemone");
    expect(init?.method).toBe("POST");
    const h = init?.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer sk-test");
    expect(h["Content-Type"]).toBe("application/json");
    const body = bodyOf(f);
    expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
    expect(body.model).toBe("jev-test");
    expect(Object.keys(body.questions)).toEqual(["is_sql_injection", "is_jailbreak", "is_out_of_domain"]);
    expect(body.questions.is_jailbreak.type).toBe("noul");
    expect(typeof body.questions.is_jailbreak.instructions).toBe("string");
    expect(typeof body.state.policy).toBe("string");
    expect(body.state.conversation).toEqual({ previous_user_questions: ["b", "c"], latest_user_question: "hello" });
  });
  it("adds the restricted-object question for functional non-admin only", async () => {
    const f = mockFetch(ok({ ...low, asks_restricted_object: 0.01 }));
    const r = await classifyIntent(input({ tokenRole: "functional" }), { config: cfg(), fetch: f });
    expect(Object.keys(bodyOf(f).questions)).toContain("asks_restricted_object");
    expect(r.checkSet).toBe("common+functional");
    expect(r.scores.restricted_object).toBe(0.01);

    const f2 = mockFetch(ok(low));
    const r2 = await classifyIntent(input({ tokenRole: "functional", isAdmin: true }), { config: cfg(), fetch: f2 });
    expect(Object.keys(bodyOf(f2).questions)).not.toContain("asks_restricted_object");
    expect(r2.checkSet).toBe("common");
  });
  it("never sends assistant turns or the API key in the body", async () => {
    const f = mockFetch(ok(low));
    await classifyIntent(input(), { config: cfg({ apiKey: "sk-secret" }), fetch: f });
    expect(String(f.mock.calls[0][1]?.body)).not.toContain("sk-secret");
  });
});

describe("thresholds and category", () => {
  it("allows when every score is under its threshold", async () => {
    const r = await classifyIntent(input(), { config: cfg(), fetch: mockFetch(ok({ ...low, is_jailbreak: 0.49 })) });
    expect(r).toMatchObject({ outcome: "allowed", block: false, category: null, refusal: null });
    expect(r.scores).toEqual({ sql_injection: 0.01, jailbreak: 0.49, out_of_domain: 0.03 });
    expect(blockedCategoryOf(r)).toBeNull();
  });
  it("flags at exactly the threshold", async () => {
    const r = await classifyIntent(input(), { config: cfg(), fetch: mockFetch(ok({ ...low, is_out_of_domain: 0.5 })) });
    expect(r).toMatchObject({ outcome: "blocked", block: true, category: "out_of_domain", refusal: REFUSALS.out_of_domain });
    expect(blockedCategoryOf(r)).toBe("out_of_domain");
  });
  it("uses custom thresholds per category", async () => {
    const thresholds = { sql_injection: 0.9, jailbreak: 0.1, out_of_domain: 0.5, restricted_object: 0.5 };
    const a = await classifyIntent(input(), { config: cfg({ thresholds }), fetch: mockFetch(ok({ is_sql_injection: 0.8, is_jailbreak: 0.05, is_out_of_domain: 0.1 })) });
    expect(a.outcome).toBe("allowed");
    const b = await classifyIntent(input(), { config: cfg({ thresholds }), fetch: mockFetch(ok({ is_sql_injection: 0.8, is_jailbreak: 0.15, is_out_of_domain: 0.1 })) });
    expect(b).toMatchObject({ outcome: "blocked", category: "jailbreak" });
  });
  it("blocks with the highest flagged score", async () => {
    const r = await classifyIntent(input({ tokenRole: "functional" }), {
      config: cfg(),
      fetch: mockFetch(ok({ is_sql_injection: 0.6, is_jailbreak: 0.95, is_out_of_domain: 0.7, asks_restricted_object: 0.9 })),
    });
    expect(r).toMatchObject({ category: "jailbreak", refusal: REFUSALS.jailbreak });
  });
  it("ignores a high unflagged score when picking the category", async () => {
    const thresholds = { sql_injection: 0.5, jailbreak: 0.99, out_of_domain: 0.5, restricted_object: 0.5 };
    const r = await classifyIntent(input(), { config: cfg({ thresholds }), fetch: mockFetch(ok({ is_sql_injection: 0.6, is_jailbreak: 0.95, is_out_of_domain: 0.1 })) });
    expect(r.category).toBe("sql_injection");
  });
  it("reports latency and the model", async () => {
    const r = await classifyIntent(input(), { config: cfg(), fetch: mockFetch(ok(low)) });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.model).toBe("jev-1.14.0");
    expect(r.mode).toBe("enforce");
  });
});

describe("shadow mode", () => {
  it("logs a would_block but never blocks", async () => {
    const r = await classifyIntent(input(), { config: cfg({ mode: "shadow" }), fetch: mockFetch(ok({ ...low, is_sql_injection: 0.99 })) });
    expect(r).toMatchObject({ outcome: "would_block", block: false, category: "sql_injection", refusal: null });
    expect(blockedCategoryOf(r)).toBeNull();
  });
  it.each([
    ["http 500", () => mockFetch(new Response("no", { status: 500 })), "http_500"],
    ["network", () => mockFetch(new TypeError("fetch failed")), "network"],
    ["bad output", () => mockFetch(ok({ is_sql_injection: 0.1 })), "bad_output"],
  ])("does not block on %s", async (_n, make, reason) => {
    const r = await classifyIntent(input(), { config: cfg({ mode: "shadow" }), fetch: make() });
    expect(r).toMatchObject({ outcome: "error", block: false, category: null, refusal: null, error: reason });
    expect(blockedCategoryOf(r)).toBeNull();
  });
});

describe("enforce mode failures", () => {
  const blocked = (r: Awaited<ReturnType<typeof classifyIntent>>, reason: string) => {
    expect(r).toMatchObject({ outcome: "error", block: true, category: null, refusal: REFUSALS.classifier_error, error: reason });
    expect(blockedCategoryOf(r)).toBe("classifier_error");
  };
  it("blocks on timeout", async () => {
    const f = vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
    blocked(await classifyIntent(input(), { config: cfg({ timeoutMs: 30 }), fetch: f }), "timeout");
  });
  it("blocks on http errors", async () => blocked(await classifyIntent(input(), { config: cfg(), fetch: mockFetch(new Response("x", { status: 401 })) }), "http_401"));
  it("blocks on network errors", async () => blocked(await classifyIntent(input(), { config: cfg(), fetch: mockFetch(new TypeError("fetch failed")) }), "network"));
  it("blocks on a missing key, a non-numeric score or invalid JSON", async () => {
    blocked(await classifyIntent(input(), { config: cfg(), fetch: mockFetch(ok({ is_sql_injection: 0.1, is_jailbreak: 0.1 })) }), "bad_output");
    const bad = new Response(JSON.stringify({ answers: { is_sql_injection: { noul: "0.1" }, is_jailbreak: { noul: 0.1 }, is_out_of_domain: { noul: 0.1 } } }), { status: 200 });
    blocked(await classifyIntent(input(), { config: cfg(), fetch: mockFetch(bad) }), "bad_output");
    blocked(await classifyIntent(input(), { config: cfg(), fetch: mockFetch(new Response("<html>", { status: 200 })) }), "bad_output");
    blocked(await classifyIntent(input(), { config: cfg(), fetch: mockFetch(ok({ ...low, is_jailbreak: 1.5 })) }), "bad_output");
  });
});

describe("callJev retry", () => {
  const c = { apiKey: "k", model: "m", baseUrl: "http://x", timeoutMs: 2000 };
  const q = questionsFor("common");
  it("retries once on 429 and succeeds", async () => {
    const f = mockFetch(new Response("slow down", { status: 429 }), ok(low));
    await expect(callJev(c, {}, q, { fetch: f, retryDelayMs: 0 })).resolves.toEqual(low);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("retries once on 529 and then gives up", async () => {
    const f = mockFetch(new Response("", { status: 529 }), new Response("", { status: 529 }), ok(low));
    await expect(callJev(c, {}, q, { fetch: f, retryDelayMs: 0 })).rejects.toMatchObject({ reason: "http_529" });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("does not retry other statuses", async () => {
    const f = mockFetch(new Response("", { status: 500 }), ok(low));
    await expect(callJev(c, {}, q, { fetch: f, retryDelayMs: 0 })).rejects.toBeInstanceOf(JevError);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("skips the retry when there is no time left inside the timeout", async () => {
    const f = mockFetch(new Response("", { status: 429, headers: { "retry-after": "5" } }), ok(low));
    await expect(callJev({ ...c, timeoutMs: 1000 }, {}, q, { fetch: f })).rejects.toMatchObject({ reason: "http_429" });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("enforce mode recovers after one 429", async () => {
    const f = mockFetch(new Response("", { status: 429 }), ok(low));
    const r = await classifyIntent(input(), { config: cfg(), fetch: f });
    expect(f).toHaveBeenCalledTimes(2);
    expect(r.outcome).toBe("allowed");
  });
});

describe("disabled", () => {
  it.each([
    ["CLASSIFIER_ENABLED false", cfg({ enabled: false })],
    ["no API key", cfg({ apiKey: "" })],
    ["defaults", intentConfig({})],
  ])("makes no request when %s", async (_n, config) => {
    const f = mockFetch(ok(low));
    const r = await classifyIntent(input({ tokenRole: "functional" }), { config, fetch: f });
    expect(f).not.toHaveBeenCalled();
    expect(r).toMatchObject({ outcome: "disabled", block: false, category: null, refusal: null, scores: {}, latencyMs: 0, checkSet: "common+functional" });
    expect(blockedCategoryOf(r)).toBeNull();
    expect(intentEnabled(config)).toBe(false);
  });
  it("is enabled with the flag and a key", () => expect(intentEnabled(cfg())).toBe(true));
});

describe("refusals", () => {
  it("has the agreed texts", () => {
    expect(REFUSALS.out_of_domain).toBe("I can only help with SpectrumERP — for example processes, screens, reports and how things are calculated.");
    expect(REFUSALS.restricted_object).toBe("That's technical detail I can't share for your role. Try asking about the business process instead, or ask a technical colleague.");
    expect(REFUSALS.sql_injection).toBe("I can't help with that.");
    expect(REFUSALS.jailbreak).toBe("I can't help with that.");
    expect(REFUSALS.classifier_error).toBe("I couldn't check that message — please try again.");
  });
  it("blocks restricted_object for a functional user with its refusal", async () => {
    const r = await classifyIntent(input({ tokenRole: "functional" }), { config: cfg(), fetch: mockFetch(ok({ ...low, asks_restricted_object: 0.8 })) });
    expect(r).toMatchObject({ block: true, category: "restricted_object", refusal: REFUSALS.restricted_object });
  });
});
