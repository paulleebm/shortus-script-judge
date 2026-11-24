import type { Scored } from "../judge/score.js";

/**
 * 방향 시험(DECISIONS 17·19): 대본을 하나만 바꾼 변형을 만들고, 정해 둔 항목이 정해 둔 방향으로 움직이는지 본다.
 * - 결함(down): 대상 항목이 1단계 이상 내려가야 한다
 * - 개선(up): 대상 항목이 1단계 이상 올라가야 한다
 * - 대조(same): 정보와 장치를 그대로 두고 바꿔 말한 것. 어느 단계 항목도 2단계 이상 움직이면 안 된다
 * - 편향(not-up): 정보 없이 꾸밈말이나 자극적 낱말만 더한 것. 대상 항목이 오르면 안 된다
 * 같은 대본을 다시 돌려도 1단계는 흔히 흔들리고 2단계 이상은 드물다(DECISIONS 13).
 */
export type VariantGroup = "결함" | "개선" | "대조" | "편향";
export type Expect = "down" | "up" | "same" | "not-up";

export const EXPECT_OF: Record<VariantGroup, Expect> = { 결함: "down", 개선: "up", 대조: "same", 편향: "not-up" };

export interface VariantSpec {
  /** 예: S01-D1 */
  id: string;
  base: string;
  /** 예: D1 */
  kind: string;
  group: VariantGroup;
  name: string;
  description: string;
  /** 움직임을 볼 항목 ID. '시청3-*'처럼 끝에 *를 붙이면 앞부분이 같은 항목 가운데 가장 낮은 단계, '*' 하나면 모든 단계 항목 */
  target: string[];
}

/** 해당 없음: 원래 대본이 이미 바닥(결함 시험의 1)이나 천장(개선 시험의 5)이라 움직일 여지가 없다(2026-11-20 2바퀴 뒤 더함) */
export type VariantVerdict = "통과" | "실패" | "판정 못 함" | "해당 없음";

export interface VariantResult {
  spec: VariantSpec;
  base: number | null;
  variant: number | null;
  verdict: VariantVerdict;
  /** 대조: 2단계 이상 움직인 항목과 비교한 항목 수 */
  bigMoves: string[];
  compared: number;
  /** 묶음 점수 변화(변형 - 원래) */
  groupShift: { watch: number | null; engage: number | null; affinity: number | null };
}

export function levelsOf(scored: Scored): Map<string, number> {
  const items = [scored.watch, scored.engage, scored.affinity].flatMap((group) => group.items);
  return new Map(items.filter((item) => item.kind === "level" && item.level !== null).map((item) => [item.id, item.level!]));
}

function matches(id: string, pattern: string): boolean {
  if (pattern === "*") return true;
  return pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern;
}

/** 대상 항목 가운데 가장 낮은 단계 */
export function targetLevel(scored: Scored, target: string[]): number | null {
  const values = [...levelsOf(scored)].filter(([id]) => target.some((pattern) => matches(id, pattern))).map(([, value]) => value);
  return values.length ? Math.min(...values) : null;
}

const shift = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round((b - a) * 100) / 100);

export function evaluateVariant(spec: VariantSpec, base: Scored, variant: Scored): VariantResult {
  const groupShift = {
    watch: shift(base.watch.score, variant.watch.score),
    engage: shift(base.engage.score, variant.engage.score),
    affinity: shift(base.affinity.score, variant.affinity.score),
  };
  const expect = EXPECT_OF[spec.group];
  if (expect === "same") {
    const before = levelsOf(base);
    const after = levelsOf(variant);
    const ids = [...before.keys()].filter((id) => after.has(id) && spec.target.some((pattern) => matches(id, pattern)));
    const bigMoves = ids.filter((id) => Math.abs(after.get(id)! - before.get(id)!) >= 2);
    return { spec, base: null, variant: null, verdict: ids.length === 0 ? "판정 못 함" : bigMoves.length ? "실패" : "통과", bigMoves, compared: ids.length, groupShift };
  }
  const before = targetLevel(base, spec.target);
  const after = targetLevel(variant, spec.target);
  let verdict: VariantVerdict;
  if (before === null || after === null) verdict = "판정 못 함";
  else if ((expect === "down" && before === 1) || (expect === "up" && before === 5)) verdict = "해당 없음";
  else if (expect === "down") verdict = after <= before - 1 ? "통과" : "실패";
  else if (expect === "up") verdict = after >= before + 1 ? "통과" : "실패";
  else verdict = after <= before ? "통과" : "실패";
  return { spec, base: before, variant: after, verdict, bigMoves: [], compared: 0, groupShift };
}

export interface VariantSummary {
  group: VariantGroup;
  n: number;
  passed: number;
  rate: number;
}

export function summarizeVariants(results: VariantResult[]): { groups: VariantSummary[]; bigMoveRate: number } {
  const groups = (["결함", "개선", "대조", "편향"] as const).map((group) => {
    const of = results.filter((result) => result.spec.group === group && result.verdict !== "판정 못 함" && result.verdict !== "해당 없음");
    const passed = of.filter((result) => result.verdict === "통과").length;
    return { group, n: of.length, passed, rate: of.length ? passed / of.length : NaN };
  });
  const controls = results.filter((result) => result.spec.group === "대조");
  const compared = controls.reduce((sum, result) => sum + result.compared, 0);
  const moved = controls.reduce((sum, result) => sum + result.bigMoves.length, 0);
  return { groups, bigMoveRate: compared ? moved / compared : NaN };
}

const signed = (value: number | null) => (value === null ? "–" : value > 0 ? `+${value}` : `${value}`);

export function formatVariants(results: VariantResult[], title: string): string {
  const { groups, bigMoveRate } = summarizeVariants(results);
  const kinds = [...new Set(results.map((result) => result.spec.kind))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return [
    `# ${title}`,
    "",
    "| 묶음 | 변형 수 | 통과 | 비율 |",
    "|---|---|---|---|",
    ...groups.map((group) => `| ${group.group} | ${group.n} | ${group.passed} | ${Number.isFinite(group.rate) ? `${Math.round(group.rate * 100)}%` : "–"} |`),
    "",
    `대조 변형에서 2단계 이상 움직인 항목: ${Number.isFinite(bigMoveRate) ? `${Math.round(bigMoveRate * 1000) / 10}%` : "–"}`,
    "",
    "| 종류 | 통과 / 변형 |",
    "|---|---|",
    ...kinds.map((kind) => {
      const of = results.filter((result) => result.spec.kind === kind);
      return `| ${kind} ${of[0]!.spec.name} (${of[0]!.spec.group}) | ${of.filter((result) => result.verdict === "통과").length} / ${of.length} |`;
    }),
    "",
    "| 변형 | 바꾼 것 | 대상 | 원래 → 변형 | 판정 | 묶음 점수 변화(시청·활동·호감) |",
    "|---|---|---|---|---|---|",
    ...results.map((result) => {
      const levels = result.spec.group === "대조" ? (result.bigMoves.length ? `2단계 이상: ${result.bigMoves.join(", ")}` : `${result.compared}개 항목 1단계 안`) : `${result.base ?? "–"} → ${result.variant ?? "–"}`;
      const shifts = [result.groupShift.watch, result.groupShift.engage, result.groupShift.affinity].map(signed).join(" · ");
      return `| ${result.spec.id} | ${result.spec.description} | ${result.spec.target.join(", ")} | ${levels} | ${result.verdict} | ${shifts} |`;
    }),
  ].join("\n");
}
