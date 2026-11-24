import { cutOpening, type Boundary, type OpeningCut } from "../rules/opening.js";
import { checkStructure } from "../rules/structure.js";
import type { Script } from "../script.js";
import { applyAudit, buildSummary } from "./audit.js";
import { estimateCostUsd, type CallRecord, type Effort, type LlmCaller, type Speed } from "./llm.js";
import { affinityCall, auditCall, engagementCall, flowCall, openingCall, PROMPT_VERSION } from "./prompts.js";
import type { FlowAnswer } from "./schemas.js";
import { scoreAll, type Scored } from "./score.js";

/** 시청2·3 질문을 몇 번 물어 가운데값을 쓸지(홀수). '다시 만들 섹션'이 2와 3 경계에서 흔들리는 것을 줄이려는 것이다 */
export const FLOW_SAMPLES = 3;

export interface JudgeOptions {
  windowSeconds?: number;
  boundary?: Boundary;
  flowSamples?: number;
}

/** 여러 번 받은 시청2·3 답을 항목마다 가운데값으로 합친다. 인용과 이유는 가운데값과 같은 단계를 준 답에서 가져온다 */
export function mergeFlow(answers: (FlowAnswer | null)[]): FlowAnswer | null {
  const valid = answers.filter((answer): answer is FlowAnswer => answer !== null);
  if (valid.length <= 1) return valid[0] ?? null;
  const pick = <T extends { level: number }>(entries: T[]): T => {
    const sorted = [...entries].sort((a, b) => a.level - b.level);
    const median = sorted[Math.floor((sorted.length - 1) / 2)]!.level;
    return entries.find((entry) => entry.level === median)!;
  };
  const sections = valid[0]!.sections.map((first) => pick(valid.flatMap((answer) => answer.sections.filter((entry) => entry.order === first.order))));
  const transitions = valid[0]!.transitions.map((first) =>
    pick(valid.flatMap((answer) => answer.transitions.filter((entry) => entry.from === first.from && entry.to === first.to))),
  );
  return { ...valid[0]!, sections, transitions };
}

export interface JudgeRun {
  scriptId: string;
  model: string;
  effort: Effort;
  speed: Speed;
  promptVersion: string;
  startedAt: string;
  elapsedMs: number;
  opening: OpeningCut;
  structureNotes: string[];
  /** 감사 전 결과 */
  before: Scored;
  /** 감사 반영 후 결과 */
  scored: Scored;
  auditOverall: string | null;
  /** 감사 호출에 보낸 정리본 */
  summary: string;
  records: CallRecord[];
  costUsd: number;
}

/**
 * 판정 흐름: 규칙(첫 3초, 구성) → 묶음별 LLM 호출 4개를 동시에 → 인용 대조와 단계 계산 → 정리본을 만들어 감사 호출 → 감사 반영.
 */
export async function judgeScript(script: Script, caller: LlmCaller, options: JudgeOptions = {}): Promise<JudgeRun> {
  const startedAt = new Date();
  const opening = cutOpening(script.sections, options.windowSeconds ?? 3, options.boundary ?? "end");
  const structureNotes = checkStructure(script);

  const samples = Math.max(1, options.flowSamples ?? FLOW_SAMPLES);
  const [openingResult, engageResult, affinityResult, ...flowResults] = await Promise.all([
    caller.call(openingCall(script, opening)),
    caller.call(engagementCall(script)),
    caller.call(affinityCall(script, opening)),
    ...Array.from({ length: samples }, (_, index) => caller.call(flowCall(script, index + 1))),
  ]);

  const before = scoreAll(script, opening, {
    opening: openingResult.output,
    flow: mergeFlow(flowResults.map((result) => result.output)),
    engage: engageResult.output,
    affinity: affinityResult.output,
  });

  const summary = buildSummary(script, opening, before, structureNotes);
  const auditResult = await caller.call(auditCall(summary));
  const scored = applyAudit(before, auditResult.output);

  const records = [openingResult.record, ...flowResults.map((result) => result.record), engageResult.record, affinityResult.record, auditResult.record];
  return {
    scriptId: script.id,
    model: caller.model,
    effort: caller.effort,
    speed: caller.speed,
    promptVersion: PROMPT_VERSION,
    startedAt: startedAt.toISOString(),
    elapsedMs: Date.now() - startedAt.getTime(),
    opening,
    structureNotes,
    before,
    scored,
    auditOverall: auditResult.output?.overall ?? null,
    summary,
    records,
    costUsd: estimateCostUsd(records),
  };
}
