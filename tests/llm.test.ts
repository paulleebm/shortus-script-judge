import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAnthropicCaller, estimateCostUsd, MODEL, requestHash, type CallSpec } from "../src/judge/llm.js";

/**
 * 실제 API를 부르는 호출기의 분기 시험. API 클라이언트는 가짜로 바꿔 끼운다(실제 요청 없음).
 */
const Answer = z.object({ level: z.number().int().min(1).max(5), reason: z.string() });
const spec: CallSpec<z.infer<typeof Answer>> = { name: "test-call", system: "시스템", user: "질문", schema: Answer };

type FakeStep = { stop_reason: string; text: string } | Error;

function fakeClient(steps: FakeStep[]) {
  const create = vi.fn(async (params: unknown) => {
    const step = steps.shift();
    if (!step) throw new Error("가짜 응답이 더 없음");
    if (step instanceof Error) throw step;
    const speed = (params as { speed?: string }).speed ?? "standard";
    return {
      stop_reason: step.stop_reason,
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, speed },
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: step.text },
      ],
    };
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const ok = (text: string) => ({ stop_reason: "end_turn", text });
const apiError = (status: number) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: "m" } }, "m", new Headers());

describe("API 호출기", () => {
  it("정상 응답을 스키마로 검사해 돌려주고 요청 형식을 지킨다", async () => {
    const { client, create } = fakeClient([ok('{"level":4,"reason":"근거"}')]);
    const { output, record } = await createAnthropicCaller({ effort: "medium", client }).call(spec);

    expect(output).toEqual({ level: 4, reason: "근거" });
    expect(record).toMatchObject({ attempts: 1, error: null, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 } });
    expect(record.request_hash).toBe(requestHash(MODEL, "medium", "시스템", "질문"));

    const params = create.mock.calls[0]![0] as Record<string, unknown> & { output_config: { effort: string; format: { type: string } } };
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.system).toBe("시스템");
    expect(params.messages).toEqual([{ role: "user", content: "질문" }]);
    expect(params.output_config.effort).toBe("medium");
    expect(params.output_config.format.type).toBe("json_schema");
    expect(params).not.toHaveProperty("speed");
    expect(record).toMatchObject({ model: "claude-opus-5-5", speed: "standard" });
  });

  it("모델과 노력 단계를 바꿔 보낼 수 있다", async () => {
    const { client, create } = fakeClient([ok('{"level":4,"reason":"근거"}')]);
    const { record } = await createAnthropicCaller({ model: "claude-sonnet-5-5", effort: "low", client }).call(spec);

    const params = create.mock.calls[0]![0] as { model: string; output_config: { effort: string } };
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.output_config.effort).toBe("low");
    expect(record).toMatchObject({ model: "claude-sonnet-5-5", effort: "low" });
    expect(record.request_hash).toBe(requestHash("claude-sonnet-5-5", "low", "시스템", "질문"));
  });

  it("고속 모드를 요청하고, 실제로 쓰인 속도를 남긴다", async () => {
    const { client, create } = fakeClient([ok('{"level":4,"reason":"근거"}')]);
    const { record } = await createAnthropicCaller({ effort: "low", speed: "fast", client }).call(spec);

    expect((create.mock.calls[0]![0] as { speed?: string }).speed).toBe("fast");
    expect(record.speed).toBe("fast");
  });

  it("고속 모드 한도에 걸리면 표준 속도로 다시 보낸다", async () => {
    const { client, create } = fakeClient([apiError(429), ok('{"level":4,"reason":"근거"}')]);
    const { output, record } = await createAnthropicCaller({ effort: "low", speed: "fast", client }).call(spec);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1]![0]).not.toHaveProperty("speed");
    expect(output).toEqual({ level: 4, reason: "근거" });
    expect(record.speed).toBe("standard");
  });

  it("형식이 틀리면 한 번 다시 묻고, 두 번의 사용량을 합친다", async () => {
    const { client, create } = fakeClient([ok('{"level":7,"reason":"범위 밖"}'), ok('{"level":3,"reason":"다시"}')]);
    const { output, record } = await createAnthropicCaller({ effort: "medium", client }).call(spec);

    expect(create).toHaveBeenCalledTimes(2);
    expect(output).toEqual({ level: 3, reason: "다시" });
    expect(record.attempts).toBe(2);
    expect(record.usage).toMatchObject({ input_tokens: 200, output_tokens: 100 });
  });

  it("두 번 다 형식이 틀리면 output 없이 이유를 남긴다", async () => {
    const { client } = fakeClient([ok("JSON 아님"), ok('{"level":"높음"}')]);
    const { output, record } = await createAnthropicCaller({ effort: "medium", client }).call(spec);

    expect(output).toBeNull();
    expect(record.attempts).toBe(2);
    expect(record.error).toMatch(/^형식 오류/);
  });

  it("max_tokens로 잘린 응답은 다시 묻고, 계속 잘리면 그 이유를 남긴다", async () => {
    const { client, create } = fakeClient([
      { stop_reason: "max_tokens", text: '{"level":4,"rea' },
      { stop_reason: "max_tokens", text: '{"level":4,"reas' },
    ]);
    const { output, record } = await createAnthropicCaller({ effort: "medium", client }).call(spec);

    expect(create).toHaveBeenCalledTimes(2);
    expect(output).toBeNull();
    expect(record.error).toBe("max_tokens");
  });

  it("거절(refusal)은 다시 묻지 않는다", async () => {
    const { client, create } = fakeClient([{ stop_reason: "refusal", text: "" }]);
    const { output, record } = await createAnthropicCaller({ effort: "medium", client }).call(spec);

    expect(create).toHaveBeenCalledTimes(1);
    expect(output).toBeNull();
    expect(record).toMatchObject({ attempts: 1, error: "refusal", stop_reason: "refusal" });
  });

  it("일시적인 API 오류는 다시 묻지 않고 기록만 남긴다(재시도는 SDK가 이미 했다)", async () => {
    const { client, create } = fakeClient([apiError(500)]);
    const { output, record } = await createAnthropicCaller({ effort: "medium", client }).call(spec);

    expect(create).toHaveBeenCalledTimes(1);
    expect(output).toBeNull();
    expect(record.error).toMatch(/^API 오류 500/);
  });

  it.each([401, 403])("인증·권한 오류(%i)는 바로 멈춘다", async (status) => {
    const { client } = fakeClient([apiError(status)]);
    await expect(createAnthropicCaller({ effort: "medium", client }).call(spec)).rejects.toBeInstanceOf(Anthropic.APIError);
  });

  it("API 오류가 아닌 예외는 숨기지 않고 그대로 던진다", async () => {
    const { client } = fakeClient([new TypeError("설정 문제")]);
    await expect(createAnthropicCaller({ effort: "medium", client }).call(spec)).rejects.toThrow("설정 문제");
  });
});

describe("비용 어림", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 0 };

  it("모델과 속도마다 가격을 따로 쓴다", () => {
    expect(estimateCostUsd([{ model: "claude-opus-5-5", speed: "standard", usage }])).toBe(24);
    expect(estimateCostUsd([{ model: "claude-opus-5-5", speed: "fast", usage }])).toBe(48);
    expect(estimateCostUsd([{ model: "claude-sonnet-5-5", speed: "standard", usage }])).toBe(12);
  });
});
