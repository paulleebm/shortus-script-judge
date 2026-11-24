import { access, appendFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { judgeScript, type JudgeRun } from "../judge/index.js";
import {
  createAnthropicCaller,
  createReplayCaller,
  DEFAULT_EFFORT,
  estimateCostUsd,
  type CallResult,
  type CallSpec,
  type LlmCaller,
  type Speed,
} from "../judge/llm.js";
import { PROMPT_VERSION } from "../judge/prompts.js";
import { recordFixtures } from "../report.js";
import type { Script } from "../script.js";

/** 응답 기록 폴더. 같은 대본을 여러 번 판정하면 두 번째부터 '<ID>~2'처럼 번호를 붙인다 */
export function fixtureName(id: string, repeat = 1): string {
  return repeat > 1 ? `${id}~${repeat}` : id;
}

export const fixtureRoot = () => join("fixtures", PROMPT_VERSION);

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * 이전 프롬프트 버전에 같은 질문 글(요청 해시가 같음)로 받은 응답이 있으면 다시 쓴다. 질문이 같으니 같은 분포의 표본이다.
 * 같은 대본·같은 반복 번호의 폴더에서만 찾아서, 다시 판정한 표본끼리 섞이지 않는다.
 */
function reusing(live: LlmCaller, name: string): LlmCaller {
  return {
    model: live.model,
    effort: live.effort,
    speed: live.speed,
    async call<T>(spec: CallSpec<T>): Promise<CallResult<T>> {
      const versions = (await readdir("fixtures").catch(() => [] as string[])).filter((version) => version !== PROMPT_VERSION).sort().reverse();
      for (const version of versions) {
        try {
          const result = await createReplayCaller(join("fixtures", version, name), live.model, live.effort).call(spec);
          if (result.output !== null && !result.record.error) return { output: result.output, record: { ...result.record, reused: version } };
        } catch {
          // 그 버전에는 같은 요청의 응답이 없다
        }
      }
      return live.call(spec);
    },
  };
}

export interface JudgeOptions {
  record: boolean;
  speed: Speed;
  /** 한 번에 판정하는 대본 수 */
  concurrency: number;
  /** 이번 실행에서 이만큼 쓰면 더 기록하지 않는다(달러) */
  maxSpend: number;
}

/**
 * 응답 기록이 있으면 그것으로(요금 없음), 없고 record면 실제로 판정해 기록한다.
 * 실제 판정의 비용은 runs/eval/ledger.jsonl에 한 줄씩 남겨 예산을 센다.
 */
export function createJudge(options: JudgeOptions) {
  let live: LlmCaller | undefined;
  let spent = 0;
  let skipped = 0;
  return {
    get spent() {
      return spent;
    },
    get skipped() {
      return skipped;
    },
    async run(script: Script, repeat = 1): Promise<JudgeRun | null> {
      const name = fixtureName(script.id, repeat);
      const dir = join(fixtureRoot(), name);
      if (await exists(dir)) return judgeScript(script, createReplayCaller(dir));
      if (!options.record) return null;
      if (spent >= options.maxSpend) {
        skipped += 1;
        return null;
      }
      live ??= createAnthropicCaller({ effort: DEFAULT_EFFORT, speed: options.speed });
      const run = await judgeScript(script, reusing(live, name));
      await recordFixtures(run, fixtureRoot(), name);
      const fresh = run.records.filter((record) => !record.reused);
      const reused = run.records.length - fresh.length;
      const cost = estimateCostUsd(fresh);
      spent += cost;
      await mkdir(join("runs", "eval"), { recursive: true });
      await appendFile(
        join("runs", "eval", "ledger.jsonl"),
        `${JSON.stringify({ at: new Date().toISOString(), id: name, promptVersion: PROMPT_VERSION, speed: options.speed, costUsd: cost, reused })}\n`,
        "utf8",
      );
      console.log(`판정: ${name} ${(run.elapsedMs / 1000).toFixed(1)}초 $${cost.toFixed(3)}${reused ? ` (응답 ${reused}개 다시 씀)` : ""}`);
      return run;
    },
  };
}

export type Judge = ReturnType<typeof createJudge>;

/** 순서를 지키며 한 번에 limit개씩 돌린다 */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
