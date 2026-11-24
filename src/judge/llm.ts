import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { createClient } from "../auth.js";

export const MODEL = "claude-opus-5-5";
/** 고속 모드(speed: fast)를 받는 모델(2026-11-12 공식 문서 기준) */
export const FAST_MODELS: readonly string[] = ["claude-opus-5-5"];

/** 달러, 100만 토큰당(2026-11-12 공식 가격표). 비용은 어림이다. */
const PRICE_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1 },
};
/** 고속 모드는 입력·출력·캐시 모두 표준 가격의 2배 */
const FAST_MULTIPLIER = 2;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export type Speed = "standard" | "fast";

/** 기본 설정(2026-11-12 사용자, DECISIONS 16): 개발용 5개에서 39초 → 8초, 판정당 $0.20 → $0.25 */
export const DEFAULT_EFFORT: Effort = "low";
export const DEFAULT_SPEED: Speed = "fast";

export interface CallSpec<T> {
  name: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
}

export interface CallRecord {
  name: string;
  model: string;
  effort: Effort;
  /** 실제로 쓰인 속도. 고속 모드 한도에 걸려 표준으로 다시 보냈으면 standard */
  speed: Speed;
  request_hash: string;
  request: { system: string; user: string };
  raw_text: string | null;
  output: unknown;
  stop_reason: string | null;
  usage: Usage | null;
  attempts: number;
  latency_ms: number;
  error: string | null;
  /** 이전 프롬프트 버전에서 같은 요청으로 받은 응답을 다시 쓴 경우 그 버전(요금이 들지 않았다) */
  reused?: string;
}

export interface CallResult<T> {
  output: T | null;
  record: CallRecord;
}

export interface LlmCaller {
  readonly model: string;
  readonly effort: Effort;
  readonly speed: Speed;
  call<T>(spec: CallSpec<T>): Promise<CallResult<T>>;
}

export function requestHash(model: string, effort: Effort, system: string, user: string): string {
  return createHash("sha256").update(JSON.stringify([model, effort, system, user])).digest("hex").slice(0, 16);
}

export function estimateCostUsd(records: Pick<CallRecord, "model" | "speed" | "usage">[]): number {
  const total = records.reduce((sum, { model, speed, usage }) => {
    const price = PRICE_PER_MTOK[model];
    if (!usage || !price) return sum;
    const multiplier = speed === "fast" ? FAST_MULTIPLIER : 1;
    const dollars =
      usage.input_tokens * price.input + usage.output_tokens * price.output + usage.cache_read_input_tokens * price.cacheRead;
    return sum + (dollars * multiplier) / 1_000_000;
  }, 0);
  return Math.round(total * 10_000) / 10_000;
}

export interface CallerOptions {
  /** 기본 MODEL */
  model?: string;
  effort: Effort;
  /** 기본 standard. fast는 FAST_MODELS에서만 */
  speed?: Speed;
  maxTokens?: number;
  client?: Anthropic;
}

/**
 * 실제 API를 부르는 호출기.
 * 인증 정보는 코드에 넣지 않는다. 클라이언트 만들기는 src/auth.ts가 맡는다
 * (Workload Identity Federation, `ant auth login` 프로필 등).
 * 형식이 틀린 응답은 한 번 다시 묻고, 또 틀리면 output을 null로 돌려준다.
 */
export function createAnthropicCaller(options: CallerOptions): LlmCaller {
  const client = options.client ?? createClient();
  const maxTokens = options.maxTokens ?? 12_000;
  const model = options.model ?? MODEL;
  const speed = options.speed ?? "standard";
  if (speed === "fast" && !FAST_MODELS.includes(model)) {
    throw new Error(`${model}은 고속 모드를 받지 않아요. 고속 모드는 ${FAST_MODELS.join(", ")}에서만 써요.`);
  }

  /** 고속 모드 한도(429)에 걸리면 표준 속도로 한 번 더 보낸다. SDK가 429를 먼저 두 번 재시도한 뒤다 */
  async function send(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    try {
      return await client.messages.create(params);
    } catch (error) {
      if (params.speed !== "fast" || !(error instanceof Anthropic.RateLimitError)) throw error;
      const { speed: _fast, ...standard } = params;
      return client.messages.create(standard);
    }
  }

  return {
    model,
    effort: options.effort,
    speed,
    async call<T>(spec: CallSpec<T>): Promise<CallResult<T>> {
      const started = Date.now();
      const record: CallRecord = {
        name: spec.name,
        model,
        effort: options.effort,
        speed,
        request_hash: requestHash(model, options.effort, spec.system, spec.user),
        request: { system: spec.system, user: spec.user },
        raw_text: null,
        output: null,
        stop_reason: null,
        usage: null,
        attempts: 0,
        latency_ms: 0,
        error: null,
      };

      for (let attempt = 1; attempt <= 2; attempt++) {
        record.attempts = attempt;
        try {
          const response = await send({
            model,
            max_tokens: maxTokens,
            system: spec.system,
            messages: [{ role: "user", content: spec.user }],
            output_config: { effort: options.effort, format: zodOutputFormat(spec.schema) },
            ...(speed === "fast" ? { speed: "fast" as const } : {}),
          });
          record.speed = response.usage.speed === "fast" ? "fast" : "standard";
          record.stop_reason = response.stop_reason;
          record.usage = addUsage(record.usage, response.usage);
          record.raw_text = response.content
            .flatMap((block) => (block.type === "text" ? [block.text] : []))
            .join("");

          if (response.stop_reason === "refusal") {
            record.error = "refusal";
            break;
          }
          const parsed = parseJson(record.raw_text, spec.schema);
          if (parsed.ok) {
            record.output = parsed.value;
            record.error = null;
            record.latency_ms = Date.now() - started;
            return { output: parsed.value, record };
          }
          record.error = response.stop_reason === "max_tokens" ? "max_tokens" : `형식 오류: ${parsed.error}`;
        } catch (error) {
          // 인증·권한 문제는 다시 물어도 같으니 바로 멈춘다.
          if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
            throw error;
          }
          if (!(error instanceof Anthropic.APIError)) throw error;
          // 일시적인 오류는 SDK가 이미 재시도했다. 기록만 남기고 이 질문은 '불확실'로 둔다.
          record.error = `API 오류 ${error.status ?? ""}: ${error.message}`;
          break;
        }
      }

      record.latency_ms = Date.now() - started;
      return { output: null, record };
    },
  };
}

/**
 * 저장해 둔 응답으로 다시 돌리는 호출기. API를 부르지 않는다.
 * 프롬프트나 대본이 바뀌어 요청이 달라지면 멈춘다(옛 응답을 새 질문의 답으로 쓰지 않기 위해).
 */
export function createReplayCaller(fixtureDir: string, model = MODEL, effort: Effort = DEFAULT_EFFORT): LlmCaller {
  return {
    model,
    effort,
    speed: "standard",
    async call<T>(spec: CallSpec<T>): Promise<CallResult<T>> {
      const path = join(fixtureDir, `${spec.name}.json`);
      const text = await readFile(path, "utf8").catch(() => {
        throw new Error(`저장된 응답이 없어요: ${path}\n먼저 --record를 붙여 실제 판정을 한 번 돌리세요.`);
      });
      // 2026-11-12 이전 기록에는 speed가 없다(모두 표준 속도였다)
      const saved = { speed: "standard", ...(JSON.parse(text) as Partial<CallRecord>) } as CallRecord;
      const hash = requestHash(saved.model, saved.effort, spec.system, spec.user);
      if (hash !== saved.request_hash) {
        throw new Error(`${path}: 저장된 응답이 지금 요청과 달라요. 프롬프트나 대본이 바뀌었으면 --record로 다시 기록하세요.`);
      }
      const parsed = saved.raw_text === null ? null : parseJson(saved.raw_text, spec.schema);
      const output = parsed?.ok ? parsed.value : null;
      return { output, record: { ...saved, output } };
    },
  };
}

function parseJson<T>(text: string | null, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  if (!text) return { ok: false, error: "빈 응답" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "JSON이 아님" };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    error: result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; "),
  };
}

function addUsage(
  previous: Usage | null,
  next: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null },
): Usage {
  return {
    input_tokens: (previous?.input_tokens ?? 0) + next.input_tokens,
    output_tokens: (previous?.output_tokens ?? 0) + next.output_tokens,
    cache_read_input_tokens: (previous?.cache_read_input_tokens ?? 0) + (next.cache_read_input_tokens ?? 0),
  };
}
