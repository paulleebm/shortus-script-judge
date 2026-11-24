import { join } from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { loadLocalEnv } from "./auth.js";
import { judgeScript } from "./judge/index.js";
import { createAnthropicCaller, createReplayCaller, DEFAULT_EFFORT, DEFAULT_SPEED, MODEL, type Effort, type Speed } from "./judge/llm.js";
import { PROMPT_VERSION } from "./judge/prompts.js";
import { formatConsole, recordFixtures, writeRun } from "./report.js";
import type { Boundary } from "./rules/opening.js";
import { loadScript } from "./script.js";

const USAGE = `사용법: npm run judge -- <대본.json> [옵션]
  --replay           fixtures/<프롬프트 버전>/<대본ID>/에 저장된 응답으로 실행(API를 부르지 않음)
  --record           이번 응답을 fixtures/<프롬프트 버전>/<대본ID>/에 저장
  --model <모델>     기본 claude-opus-5-5 (예: claude-sonnet-5-5)
  --effort <값>      low | medium | high | xhigh | max (기본 low)
  --speed <값>       standard | fast (기본 fast, 표준 속도의 2배 요금)
  --window <초>      첫 3초 판정 구간(기본 3)
  --boundary <값>    end: 구간 안에 끝나는 단어까지, start: 구간 안에 시작하는 단어까지(기본 end)
  --out <폴더>       결과를 남길 폴더(기본 runs)`;

const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const BOUNDARIES: Boundary[] = ["end", "start"];
const SPEEDS: Speed[] = ["standard", "fast"];

async function main(): Promise<void> {
  loadLocalEnv();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      replay: { type: "boolean", default: false },
      record: { type: "boolean", default: false },
      model: { type: "string", default: MODEL },
      effort: { type: "string", default: DEFAULT_EFFORT },
      speed: { type: "string", default: DEFAULT_SPEED },
      window: { type: "string", default: "3" },
      boundary: { type: "string", default: "end" },
      out: { type: "string", default: "runs" },
    },
  });

  const scriptPath = positionals[0];
  const effort = values.effort as Effort;
  const speed = values.speed as Speed;
  const boundary = values.boundary as Boundary;
  const windowSeconds = Number(values.window);
  if (!scriptPath || !EFFORTS.includes(effort) || !SPEEDS.includes(speed) || !BOUNDARIES.includes(boundary) || !(windowSeconds > 0)) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const script = await loadScript(scriptPath);
  // 응답은 프롬프트 버전별로 따로 둔다. 프롬프트를 고쳐도 예전 버전의 실제 응답이 기록으로 남는다.
  const fixtureRoot = join("fixtures", PROMPT_VERSION);
  const caller = values.replay ? createReplayCaller(join(fixtureRoot, script.id)) : createAnthropicCaller({ model: values.model, effort, speed });

  const run = await judgeScript(script, caller, { windowSeconds, boundary });
  console.log(formatConsole(run));

  const dir = await writeRun(run, values.out);
  console.log(`\n기록: ${dir}`);
  if (values.record && !values.replay) {
    console.log(`응답 저장: ${await recordFixtures(run, fixtureRoot)}`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error(`인증이 거절됐어요(${error.status}). ${AUTH_HINT}`);
  } else if (error instanceof Error) {
    console.error(error.message);
    if (/auth/i.test(error.name) || /credential|authentication/i.test(error.message)) console.error(AUTH_HINT);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

const AUTH_HINT = `인증 정보는 코드에 넣지 않고 환경(.env.local 포함)에서 읽어요. 설정 순서는 docs/wif-setup.md에 있고, 'npm run auth:check'로 요금 없이 확인할 수 있어요.`;
