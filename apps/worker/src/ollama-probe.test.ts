import { describe, expect, it, vi } from "vitest";

import { probeOllamaStartup, type OllamaProbeFetch } from "./ollama-probe.js";

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("probeOllamaStartup", () => {
  it("reports an unreachable server without network access", async () => {
    const fetch = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const result = await probeOllamaStartup({ baseUrl: "http://ollama.test", model: "m", fetch });
    expect(result).toMatchObject({ reachable: false, degradedMode: true });
  });

  it("reports an absent model", async () => {
    const fetch: OllamaProbeFetch = async () => response({ models: [{ name: "other" }] });
    const result = await probeOllamaStartup({ baseUrl: "http://ollama.test", model: "m", fetch });
    expect(result).toMatchObject({ reachable: true, modelPresent: false, degradedMode: true });
  });

  it("accepts generation with an object JSON response", async () => {
    let call = 0;
    const fetch: OllamaProbeFetch = async () => {
      call += 1;
      return call === 1
        ? response({ models: [{ name: "m:latest" }] })
        : call === 2
          ? response({ models: [{ name: "m:latest" }] })
          : response({ response: '{"schemaVersion":"1","ok":true}' });
    };
    const result = await probeOllamaStartup({ baseUrl: "http://ollama.test/", model: "m", fetch });
    expect(result).toMatchObject({ generationOk: true, parseOk: true, degradedMode: false, baseUrl: "http://ollama.test" });
  });

  it("enters degraded mode when generation fails", async () => {
    let call = 0;
    const fetch: OllamaProbeFetch = async () => {
      call += 1;
      return call <= 2
        ? response({ models: [{ name: "m" }] })
        : response({ error: "model crashed" }, false, 500);
    };
    const result = await probeOllamaStartup({ baseUrl: "http://ollama.test", model: "m", fetch });
    expect(result).toMatchObject({ reachable: true, modelPresent: true, generationOk: false, degradedMode: true });
  });
});
