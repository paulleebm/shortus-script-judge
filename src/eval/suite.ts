import type { Scored } from "../judge/score.js";
import { agreement, type AgreementReport, type FamilyStats } from "./agreement.js";
import { summarizeVariants, type VariantResult } from "./variants.js";

/**
 * 검증 묶음 점수표(DECISIONS 19). 끝내는 조건은 측정 전에 정했다. 결과를 보고 바꾸지 않는다.
 */
export const EXIT = {
  /** 결함 변형의 대상 항목이 1단계 이상 내려간 비율 */
  defectDown: 0.85,
  /** 개선 변형의 대상 항목이 1단계 이상 오른 비율 */
  improveUp: 0.8,
  /** 대조 변형에서 2단계 이상 움직인 항목 비율(이하) */
  controlBigMove: 0.05,
  /** 편향 변형에서 대상 항목이 오른 비율(이하) */
  biasUp: 0.2,
  /** 판정기와 판정자의 단계 항목 1단계 안 */
  judgeWithin1: 0.85,
  /** 판정기와 판정자의 단계 항목 정확히 같음 */
  judgeExact: 0.5,
  /** 질문별 판정기-판정자 1단계 안의 최저(2026-11-20 1바퀴 뒤 더함: 전체 평균이 한 질문의 문제를 가렸다) */
  judgeFamilyWithin1: 0.8,
  /** 판정자끼리보다 판정기-판정자 1단계 안 일치가 이만큼 넘게 낮으면 미달 */
  judgeGap: 0.1,
  /** 판정자끼리 단계 항목 1단계 안(기준의 명확성) */
  raterWithin1: 0.85,
  /** 다시 판정했을 때 단계 항목 1단계 안 */
  stableWithin1: 0.95,
  /** 다시 판정했을 때 '다시 만들 섹션'이 같은 대본 비율 */
  stableRegenerate: 0.75,
} as const;

export interface Labeled {
  id: string;
  scored: Scored;
}

export interface Comparison {
  a: string;
  b: string;
  report: AgreementReport;
}

/** 두 판정 묶음(판정기, 판정자, 다시 판정한 판정기)을 대본 ID로 맞춰 비교한다. a를 기준(사람 자리)으로 둔다 */
export function compare(a: string, aLabels: Labeled[], b: string, bLabels: Labeled[]): Comparison {
  const byId = new Map(bLabels.map((label) => [label.id, label.scored]));
  const comparisons = aLabels.flatMap((label) => {
    const other = byId.get(label.id);
    return other ? [{ id: label.id, human: label.scored, judge: other, topicsLabeled: true }] : [];
  });
  return { a, b, report: agreement(comparisons) };
}

/** 다시 만들 섹션이 똑같은 대본 수 */
export function sameRegenerate(report: AgreementReport): { same: number; n: number } {
  const same = report.rows.filter((row) => [...row.regenerateHuman].sort().join() === [...row.regenerateJudge].sort().join()).length;
  return { same, n: report.rows.length };
}

export interface Scorecard {
  version: string;
  variants: VariantResult[];
  judgeVsRaters: Comparison[];
  raterPairs: Comparison[];
  stability: Comparison | null;
}

const pct = (value: number) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : "–");
const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);

interface Check {
  name: string;
  line: string;
  value: string;
  pass: boolean | null;
}

export function checks(card: Scorecard): Check[] {
  const { groups, bigMoveRate } = summarizeVariants(card.variants);
  const rate = (group: string) => groups.find((entry) => entry.group === group)!;
  const defect = rate("결함");
  const improve = rate("개선");
  const bias = rate("편향");
  const biasUp = bias.n ? (bias.n - bias.passed) / bias.n : NaN;
  const judgeWithin1 = mean(card.judgeVsRaters.map((entry) => entry.report.overall.within1));
  const judgeExact = mean(card.judgeVsRaters.map((entry) => entry.report.overall.exact));
  const raterWithin1 = mean(card.raterPairs.map((entry) => entry.report.overall.within1));
  const familyNames = [...new Set(card.judgeVsRaters.flatMap((entry) => entry.report.families.map((family) => family.family)))];
  const familyWithin1 = familyNames.map((family) => ({
    family,
    value: mean(card.judgeVsRaters.flatMap((entry) => entry.report.families.filter((stats) => stats.family === family).map((stats) => stats.within1))),
  }));
  const worstFamily = familyWithin1.reduce<{ family: string; value: number } | null>((worst, entry) => (worst === null || entry.value < worst.value ? entry : worst), null);
  const stable = card.stability ? card.stability.report.overall.within1 : NaN;
  const regenerate = card.stability ? sameRegenerate(card.stability.report) : { same: 0, n: 0 };
  const known = (value: number) => Number.isFinite(value);
  return [
    { name: "결함이 내려감", line: `${pct(EXIT.defectDown)} 이상`, value: `${pct(defect.rate)} (${defect.passed}/${defect.n})`, pass: known(defect.rate) ? defect.rate >= EXIT.defectDown : null },
    { name: "개선이 올라감", line: `${pct(EXIT.improveUp)} 이상`, value: `${pct(improve.rate)} (${improve.passed}/${improve.n})`, pass: known(improve.rate) ? improve.rate >= EXIT.improveUp : null },
    { name: "대조에서 2단계 이상 움직임", line: `${pct(EXIT.controlBigMove)} 이하`, value: pct(bigMoveRate), pass: known(bigMoveRate) ? bigMoveRate <= EXIT.controlBigMove : null },
    { name: "편향 변형에서 오름", line: `${pct(EXIT.biasUp)} 이하`, value: `${pct(biasUp)} (${bias.n - bias.passed}/${bias.n})`, pass: known(biasUp) ? biasUp <= EXIT.biasUp : null },
    { name: "판정기-판정자 1단계 안", line: `${pct(EXIT.judgeWithin1)} 이상`, value: pct(judgeWithin1), pass: known(judgeWithin1) ? judgeWithin1 >= EXIT.judgeWithin1 : null },
    { name: "판정기-판정자 정확히 같음", line: `${pct(EXIT.judgeExact)} 이상`, value: pct(judgeExact), pass: known(judgeExact) ? judgeExact >= EXIT.judgeExact : null },
    {
      name: "질문별 판정기-판정자 1단계 안(가장 낮은 질문)",
      line: `${pct(EXIT.judgeFamilyWithin1)} 이상`,
      value: worstFamily ? `${pct(worstFamily.value)} (${worstFamily.family})` : "–",
      pass: worstFamily ? worstFamily.value >= EXIT.judgeFamilyWithin1 : null,
    },
    {
      name: "판정자끼리보다 낮은 정도",
      line: `${Math.round(EXIT.judgeGap * 100)}%p 이하`,
      value: known(raterWithin1) && known(judgeWithin1) ? `${Math.round((raterWithin1 - judgeWithin1) * 100)}%p` : "–",
      pass: known(raterWithin1) && known(judgeWithin1) ? raterWithin1 - judgeWithin1 <= EXIT.judgeGap : null,
    },
    { name: "판정자끼리 1단계 안(기준의 명확성)", line: `${pct(EXIT.raterWithin1)} 이상`, value: pct(raterWithin1), pass: known(raterWithin1) ? raterWithin1 >= EXIT.raterWithin1 : null },
    { name: "다시 판정 1단계 안", line: `${pct(EXIT.stableWithin1)} 이상`, value: pct(stable), pass: known(stable) ? stable >= EXIT.stableWithin1 : null },
    {
      name: "다시 판정 '다시 만들 섹션' 같음",
      line: `${pct(EXIT.stableRegenerate)} 이상`,
      value: regenerate.n ? `${pct(regenerate.same / regenerate.n)} (${regenerate.same}/${regenerate.n})` : "–",
      pass: regenerate.n ? regenerate.same / regenerate.n >= EXIT.stableRegenerate : null,
    },
  ];
}

function familyTable(comparisons: Comparison[]): string[] {
  if (comparisons.length === 0) return ["(자료 없음)"];
  const families = [...new Set(comparisons.flatMap((entry) => entry.report.families.map((family) => family.family)))].sort();
  const cell = (stats: FamilyStats | undefined) =>
    stats ? `${pct(stats.within1)} / ${pct(stats.exact)} / ${stats.bias >= 0 ? "+" : ""}${stats.bias.toFixed(2)}` : "–";
  return [
    `| 질문 | ${comparisons.map((entry) => `${entry.b} 대 ${entry.a}`).join(" | ")} |`,
    `|---|${comparisons.map(() => "---").join("|")}|`,
    ...families.map((family) => `| ${family} | ${comparisons.map((entry) => cell(entry.report.families.find((stats) => stats.family === family))).join(" | ")} |`),
    `| 전체 | ${comparisons.map((entry) => cell(entry.report.overall)).join(" | ")} |`,
  ];
}

export function formatScorecard(card: Scorecard): string {
  const list = checks(card);
  const passed = list.filter((check) => check.pass === true).length;
  const measured = list.filter((check) => check.pass !== null).length;
  return [
    `# 검증 묶음 점수표 · 프롬프트 ${card.version}`,
    "",
    `끝내는 조건 ${list.length}개 가운데 잰 것 ${measured}개, 넘은 것 ${passed}개`,
    "",
    "| 조건 | 통과선 | 결과 | 판정 |",
    "|---|---|---|---|",
    ...list.map((check) => `| ${check.name} | ${check.line} | ${check.value} | ${check.pass === null ? "안 잼" : check.pass ? "통과" : "미달"} |`),
    "",
    "## 질문별 일치(1단계 안 / 정확히 같음 / 치우침: 뒤쪽 - 앞쪽)",
    "",
    "판정기 대 판정자",
    "",
    ...familyTable(card.judgeVsRaters),
    "",
    "판정자끼리",
    "",
    ...familyTable(card.raterPairs),
    "",
    "다시 판정",
    "",
    ...familyTable(card.stability ? [card.stability] : []),
  ].join("\n");
}
