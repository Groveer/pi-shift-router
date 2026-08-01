/**
 * pi-shift-router — Judge fast-model fallback tests
 *
 * The Judge classifies with the fast tier's model. When that model fails
 * (429 / 5xx / network), the Judge must fall back to the NEXT model in the
 * fast tier's priority list — not silently give up and return "fast".
 *
 * These tests mock global fetch to simulate provider responses.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { classify } from "../src/judge.js";
import type { ProviderEndpoint } from "../src/types.js";

function endpoint(modelId: string, baseUrl = "https://api.example.com"): ProviderEndpoint {
  return {
    provider: "p",
    baseUrl,
    apiType: "openai-completions",
    apiKey: "test-key",
    modelId,
  };
}

/** Mock fetch with a queue of responses per call. */
function mockFetch(
  handler: (url: string, init: any) => Promise<Response | Error>,
) {
  const fn = vi.fn(handler);
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Extract the model id from a fetch request body. */
function modelFromRequest(init: any): string {
  try {
    const body = JSON.parse(init?.body ?? "{}");
    return body?.model ?? "";
  } catch {
    return "";
  }
}

function okResponse(modelId: string, tier: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ tier }) } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: { message: "fail" } }), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── Judge fallback across fast-tier models ────────────────────────
describe("classify falls back across fast-tier models", () => {
  it("uses the first endpoint when it succeeds", async () => {
    const fetchMock = mockFetch(async () => okResponse("M3", "fast"));

    const r = await classify("quick task", [endpoint("M3"), endpoint("deepseek-v4-flash")]);

    expect(r).toEqual({ tier: "fast", source: "llm" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tries the second model when the first returns 429", async () => {
    const fetchMock = mockFetch(async (_url, init) => {
      if (modelFromRequest(init) === "model-a") return errorResponse(429);
      return okResponse("model-b", "smart");
    });

    const r = await classify("complex design task", [
      endpoint("model-a"),
      endpoint("model-b"),
    ]);

    expect(r).toEqual({ tier: "smart", source: "llm" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tries the second model when the first throws a network error", async () => {
    const fetchMock = mockFetch(async (_url, init) => {
      if (modelFromRequest(init) === "model-a") throw new Error("fetch failed: ECONNRESET");
      return okResponse("model-b", "fast");
    });

    const r = await classify("quick task", [
      endpoint("model-a"),
      endpoint("model-b"),
    ]);

    expect(r).toEqual({ tier: "fast", source: "llm" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tries the second model when the first response is unparseable", async () => {
    const fetchMock = mockFetch(async (_url, init) => {
      if (modelFromRequest(init) === "model-a") return okResponse("model-a", "garbage");
      return okResponse("model-b", "smart");
    });

    const r = await classify("design review", [
      endpoint("model-a"),
      endpoint("model-b"),
    ]);

    expect(r).toEqual({ tier: "smart", source: "llm" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns fallback fast when ALL fast-tier models fail", async () => {
    const fetchMock = mockFetch(async () => errorResponse(429));

    const r = await classify("quick task", [
      endpoint("model-a"),
      endpoint("model-b"),
    ]);

    expect(r).toEqual({ tier: "fast", source: "fallback" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns fallback fast with no endpoints", async () => {
    const fetchMock = mockFetch(async () => errorResponse(429));
    const r = await classify("quick task", []);
    expect(r).toEqual({ tier: "fast", source: "fallback" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns fallback fast when endpoints is null", async () => {
    const r = await classify("quick task", null);
    expect(r).toEqual({ tier: "fast", source: "fallback" });
  });

  it("skips models in cooldown via the predicate", async () => {
    const fetchMock = mockFetch(async (_url, init) => {
      if (modelFromRequest(init) === "model-b") return okResponse("model-b", "smart");
      throw new Error("should not be called");
    });
    const isCooldown = (p: string, m: string) => p === "p" && m === "model-a";

    const r = await classify("design task", [
      endpoint("model-a"),
      endpoint("model-b"),
    ], 5000, false, isCooldown);

    expect(r).toEqual({ tier: "smart", source: "llm" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tries all models even when the first times out", async () => {
    // Simulate abort (timeout) on model-a, success on model-b
    const fetchMock = mockFetch(async (_url, init) => {
      if (modelFromRequest(init) === "model-a") {
        // Simulate timeout via abort signal
        await new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        });
        throw new DOMException("Aborted", "AbortError");
      }
      return okResponse("model-b", "fast");
    });

    const r = await classify("quick task", [
      endpoint("model-a"),
      endpoint("model-b"),
    ], 100);

    expect(r).toEqual({ tier: "fast", source: "llm" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ─── resolveFastEndpoints (config) ─────────────────────────────────
import { resolveFastEndpoints } from "../src/config.js";
import type { ModelsStore, AuthStore } from "../src/types.js";

describe("resolveFastEndpoints — Judge fast-chain fallback", () => {
  const store: ModelsStore = {
    minimax: {
      models: [
        { id: "MiniMax-M3", provider: "minimax", baseUrl: "https://api.minimax.example/", api: "openai-completions" },
      ],
    },
    deepseek: {
      models: [
        { id: "deepseek-v4-flash", provider: "deepseek", baseUrl: "https://api.deepseek.example", api: "openai-completions" },
      ],
    },
  };
  const auth: AuthStore = {
    minimax: { type: "apiKey", key: "mm-key" },
    deepseek: { type: "apiKey", key: "ds-key" },
  };
  const cfg = (fastModels: { provider: string; model: string; priority: number }[]) => ({
    tiers: { fast: { models: fastModels }, smart: { models: [] } },
  }) as any;

  it("returns the whole fast chain in priority order", async () => {
    const eps = await resolveFastEndpoints(
      cfg([
        { provider: "minimax", model: "MiniMax-M3", priority: 2 },
        { provider: "deepseek", model: "deepseek-v4-flash", priority: 1 },
      ]),
      store,
      auth,
    );
    expect(eps.map((e) => e.modelId)).toEqual(["deepseek-v4-flash", "MiniMax-M3"]);
    expect(eps[0].provider).toBe("deepseek");
    expect(eps[1].baseUrl).toBe("https://api.minimax.example"); // trailing slash trimmed
  });

  it("skips models without auth but keeps the rest", async () => {
    const eps = await resolveFastEndpoints(
      cfg([
        { provider: "minimax", model: "MiniMax-M3", priority: 1 },
        { provider: "deepseek", model: "deepseek-v4-flash", priority: 2 },
      ]),
      store,
      { deepseek: { type: "apiKey", key: "ds-key" } }, // minimax has no auth
    );
    expect(eps.map((e) => e.modelId)).toEqual(["deepseek-v4-flash"]);
  });

  it("falls back to the cheapest global model when the fast chain is unresolvable", async () => {
    const eps = await resolveFastEndpoints(cfg([
      { provider: "ghost", model: "x", priority: 1 },
    ]), store, auth);
    // Fast chain empty → cheapest model with auth (minimax) is used
    expect(eps.map((e) => e.modelId)).toEqual(["MiniMax-M3"]);
  });

  it("returns empty when NO provider has auth (nothing to judge with)", async () => {
    const eps = await resolveFastEndpoints(cfg([
      { provider: "minimax", model: "MiniMax-M3", priority: 1 },
    ]), store, {});
    expect(eps).toEqual([]);
  });
});
