import type { Scored } from "../judge/score.js";

/**
 * 사람 판정과 판정기가 얼마나 맞는지 잰다.
 * 통과선은 측정 전에 정했다(2026-11-17, Claude 제안 · 사용자 확인 필요, DECISIONS 17). 결과를 보고 바꾸지 않는다.
 */
export const PASS = {
  /** 단계 항목에서 1단계 차이 안에 드는 비율 */
  within1: 0.8,
  /** 단계 항목에서 정확히 같은 비율 */
  exact: 0.4,
  /** 묶음 점수(시청·활동·호감) 차이의 평균 */
  groupMeanAbs: 0.5,
  /** 사람이 '다시 만들 섹션'으로 본 것 가운데 판정기도 짚은 비율 */
  regenerateRecall: 0.6,
  /** 판정기가 짚은 것 가운데 사람도 짚은 비율 */
  regeneratePrecision: 0.5,
} as const;

export interface Pair {
  script: string;
  item: string;
  human: number;
  judge: number;
}

export interface FamilyStats {
  family: string;
  n: number;
  exact: number;
  within1: number;
  meanAbs: number;
  /** 판정기 - 사람의 평균. 양수면 판정기가 후하다 */
  bias: number;
}

export interface ScriptComparison {
  id: string;
  human: Scored;
  judge: Scored;
  /** 사람이 민감 주제 칸을 적었는가(비워 두면 비교하지 않는다) */
  topicsLabeled: boolean;
}

const GROUPS = [
  ["watch", "시청"],
  ["engage", "활동"],
  ["affinity", "호감"],
] as const;

function levelItems(scored: Scored): Map<string, number> {
  const items = [scored.watch, scored.engage, scored.affinity].flatMap((group) => group.items);
  return new Map(items.filter((item) => item.kind === "level" && item.level !== null).map((item) => [item.id, item.level!]));
}

function topics(scored: Scored): string[] {
  return scored.engage.items.filter((item) => item.kind === "tag" && item.status === "ok").map((item) => item.id.replace("활동1-", "")).sort();
}

/** 판정기 단계는 감사가 '불확실'로 돌린 항목도 쓴다(LLM의 판단 자체를 재려고). 인용 대조에 걸려 단계가 없는 항목은 뺀다 */
export function pairs(comparisons: ScriptComparison[]): Pair[] {
  return comparisons.flatMap(({ id, human, judge }) => {
    const judged = levelItems(judge);
    return [...levelItems(human)].flatMap(([item, value]) => {
      const other = judged.get(item);
      return other === undefined ? [] : [{ script: id, item, human: value, judge: other }];
    });
  });
}

export function familyOf(item: string): string {
  return item.split("-")[0]!;
}

export function stats(family: string, list: Pair[]): FamilyStats {
  const n = list.length;
  const diff = list.map((pair) => pair.judge - pair.human);
  return {
    family,
    n,
    exact: n ? diff.filter((d) => d === 0).length / n : NaN,
    within1: n ? diff.filter((d) => Math.abs(d) <= 1).length / n : NaN,
    meanAbs: n ? diff.reduce((sum, d) => sum + Math.abs(d), 0) / n : NaN,
    bias: n ? diff.reduce((sum, d) => sum + d, 0) / n : NaN,
  };
}

function ranks(values: number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const result = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.value === order[i]!.value) j++;
    for (let k = i; k <= j; k++) result[order[k]!.index] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return result;
}

/** 스피어만 순위 상관. 대본 수가 3개 미만이거나 한쪽이 모두 같으면 NaN */
export function spearman(xs: number[], ys: number[]): number {
  if (xs.length < 3 || xs.length !== ys.length) return NaN;
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - my) ** 2;
  }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy);
}

export interface AgreementReport {
  scripts: number;
  overall: FamilyStats;
  families: FamilyStats[];
  groups: { name: string; meanAbs: number; spearman: number; n: number }[];
  regenerate: { truePositive: number; falsePositive: number; falseNegative: number; recall: number; precision: number };
  topicsExact: { same: number; n: number };
  policy: { same: number; n: number };
  rows: { id: string; human: (number | null)[]; judge: (number | null)[]; regenerateHuman: number[]; regenerateJudge: number[] }[];
}

export function agreement(comparisons: ScriptComparison[]): AgreementReport {
  const all = pairs(comparisons);
  const families = [...new Set(all.map((pair) => familyOf(pair.item)))].sort().map((family) => stats(family, all.filter((pair) => familyOf(pair.item) === family)));

  const groups = GROUPS.map(([key, name]) => {
    const both = comparisons.filter(({ human, judge }) => human[key].score !== null && judge[key].score !== null);
    const hs = both.map(({ human }) => human[key].score!);
    const js = both.map(({ judge }) => judge[key].score!);
    return {
      name,
      n: both.length,
      meanAbs: both.length ? hs.reduce((sum, h, i) => sum + Math.abs(h - js[i]!), 0) / both.length : NaN,
      spearman: spearman(hs, js),
    };
  });

  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const { human, judge } of comparisons) {
    const h = new Set(human.regenerate.map((item) => item.section));
    const j = new Set(judge.regenerate.map((item) => item.section));
    for (const section of j) (h.has(section) ? (tp += 1) : (fp += 1));
    for (const section of h) if (!j.has(section)) fn += 1;
  }

  const withTopics = comparisons.filter(({ topicsLabeled }) => topicsLabeled);
  const withPolicy = comparisons.filter(({ human, judge }) => human.policyRisk !== null && judge.policyRisk !== null);

  return {
    scripts: comparisons.length,
    overall: stats("전체", all),
    families,
    groups,
    regenerate: { truePositive: tp, falsePositive: fp, falseNegative: fn, recall: tp + fn ? tp / (tp + fn) : NaN, precision: tp + fp ? tp / (tp + fp) : NaN },
    topicsExact: { same: withTopics.filter(({ human, judge }) => topics(human).join() === topics(judge).join()).length, n: withTopics.length },
    policy: { same: withPolicy.filter(({ human, judge }) => human.policyRisk!.present === judge.policyRisk!.present).length, n: withPolicy.length },
    rows: comparisons.map(({ id, human, judge }) => ({
      id,
      human: GROUPS.map(([key]) => human[key].score),
      judge: GROUPS.map(([key]) => judge[key].score),
      regenerateHuman: human.regenerate.map((item) => item.section),
      regenerateJudge: judge.regenerate.map((item) => item.section),
    })),
  };
}

const pct = (value: number) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : "–");
const num = (value: number, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : "–");
const mark = (ok: boolean) => (ok ? "통과" : "미달");

export function formatAgreement(report: AgreementReport, title: string): string {
  const { overall, regenerate } = report;
  const groupMeanAbs = report.groups.filter((group) => Number.isFinite(group.meanAbs)).map((group) => group.meanAbs);
  const groupAverage = groupMeanAbs.length ? groupMeanAbs.reduce((a, b) => a + b, 0) / groupMeanAbs.length : NaN;
  return [
    `# ${title}`,
    "",
    `대본 ${report.scripts}개, 단계 항목 ${overall.n}쌍`,
    "",
    "## 통과선(측정 전에 정함)",
    "",
    "| 지표 | 통과선 | 결과 | 판정 |",
    "|---|---|---|---|",
    `| 단계 항목 1단계 차이 안 | ${pct(PASS.within1)} 이상 | ${pct(overall.within1)} | ${mark(overall.within1 >= PASS.within1)} |`,
    `| 단계 항목 정확히 같음 | ${pct(PASS.exact)} 이상 | ${pct(overall.exact)} | ${mark(overall.exact >= PASS.exact)} |`,
    `| 묶음 점수 차이 평균 | ${PASS.groupMeanAbs} 이하 | ${num(groupAverage)} | ${mark(groupAverage <= PASS.groupMeanAbs)} |`,
    `| 다시 만들 섹션 재현율 | ${pct(PASS.regenerateRecall)} 이상 | ${pct(regenerate.recall)} | ${mark(regenerate.recall >= PASS.regenerateRecall)} |`,
    `| 다시 만들 섹션 정밀도 | ${pct(PASS.regeneratePrecision)} 이상 | ${pct(regenerate.precision)} | ${mark(regenerate.precision >= PASS.regeneratePrecision)} |`,
    "",
    "## 질문별",
    "",
    "| 질문 | 쌍 | 정확히 같음 | 1단계 차이 안 | 차이 평균 | 치우침(판정기 − 사람) |",
    "|---|---|---|---|---|---|",
    ...[...report.families, overall].map((family) => `| ${family.family} | ${family.n} | ${pct(family.exact)} | ${pct(family.within1)} | ${num(family.meanAbs)} | ${num(family.bias)} |`),
    "",
    "## 묶음 점수",
    "",
    "| 묶음 | 대본 | 차이 평균 | 순위 상관(스피어만) |",
    "|---|---|---|---|",
    ...report.groups.map((group) => `| ${group.name} | ${group.n} | ${num(group.meanAbs)} | ${num(group.spearman)} |`),
    "",
    `다시 만들 섹션: 둘 다 짚음 ${regenerate.truePositive}, 판정기만 ${regenerate.falsePositive}, 사람만 ${regenerate.falseNegative}`,
    `민감 주제 목록이 같음: ${report.topicsExact.same}/${report.topicsExact.n} · 정책 위험이 같음: ${report.policy.same}/${report.policy.n}`,
    "",
    "## 대본별(시청/활동/호감, 다시 만들 섹션)",
    "",
    "| 대본 | 사람 | 판정기 | 사람 섹션 | 판정기 섹션 |",
    "|---|---|---|---|---|",
    ...report.rows.map(
      (row) =>
        `| ${row.id} | ${row.human.map((v) => v ?? "–").join(" / ")} | ${row.judge.map((v) => v ?? "–").join(" / ")} | ${row.regenerateHuman.join(",") || "없음"} | ${row.regenerateJudge.join(",") || "없음"} |`,
    ),
  ].join("\n");
}
