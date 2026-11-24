import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { agreement, spearman } from "../src/eval/agreement.js";
import { parseReference } from "../src/eval/reference.js";
import { checks, compare } from "../src/eval/suite.js";
import { evaluateVariant, summarizeVariants, targetLevel, type VariantSpec } from "../src/eval/variants.js";
import { humanScored, parseHumanLabels, type HumanLabel } from "../src/eval/labels.js";
import { formatReview } from "../src/eval/review.js";
import { cutOpening } from "../src/rules/opening.js";
import { readXlsxRecords } from "../src/eval/xlsx.js";
import { ScriptSchema } from "../src/script.js";

/**
 * 검증 도구 시험. 사람 판정은 손으로 만든 값이다(실제 판정시트의 사람 판정은 쓰지 않는다).
 */
const s01 = ScriptSchema.parse(JSON.parse(readFileSync("data/scripts/S01.json", "utf8")));

const label = (overrides: Partial<HumanLabel> = {}): HumanLabel => ({
  id: "S01",
  rater: "가",
  watch1: 4,
  watch2: [4, 4, 3, 2],
  watch3: [3, 3, 3],
  topics: [],
  engage2: 3,
  engage3: 4,
  affinity1: 3,
  affinity2: 3,
  policyRisk: false,
  overall: null,
  ...overrides,
});

describe("판정시트 읽기", () => {
  it("xlsx를 라이브러리 없이 읽어 머리글로 레코드를 만든다", async () => {
    const rows = await readXlsxRecords("판정시트.xlsx", "사람 판정");
    expect(rows.map((row) => row["대본 ID"])).toContain("S02");
    expect(Object.keys(rows[0]!)).toContain("시청1: 첫 3초 궁금증 (1~5)");
    const info = await readXlsxRecords("판정시트.xlsx", "대본 정보");
    expect(info.find((row) => row["대본 ID"] === "S02")?.["세트"]).toBe("시험");
  });

  it("단계를 하나도 적지 않은 줄은 빼고, 목록·민감 주제·정책 위험을 읽는다", () => {
    const labels = parseHumanLabels([
      { "대본 ID": "S02", "시청1: 첫 3초 궁금증 (1~5)": "" },
      {
        "대본 ID": "S01",
        "판정자": "가",
        "시청1: 첫 3초 궁금증 (1~5)": "4",
        "시청2: 섹션별 정보 흥미 (1~5, 섹션 순서대로 예: 3,4,2,3)": "4, 4,3 2",
        "시청3: 연결부별 흐름 (1~5, 1→2부터 예: 4,2,3)": "3,3,9",
        "활동1: 민감 주제 (정치, 젠더, 세대, 종교, 기득권, 유명인, 없음 중 여러 개면 쉼표)": "없음",
        "정책 위험": "아니오",
      },
    ]);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ id: "S01", watch1: 4, watch2: [4, 4, 3, 2], watch3: [3, 3, null], topics: [], policyRisk: false, engage2: null });
  });
});

describe("사람 판정 일치도", () => {
  it("사람 판정도 판정기와 같은 규칙으로 묶음 점수와 다시 만들 섹션을 계산한다", () => {
    const scored = humanScored(s01, label());
    expect(scored.watch.score).toBe(3); // (4 + 가장 낮은 섹션 2 + 가장 낮은 연결부 3) / 3
    expect(scored.regenerate.map((item) => item.section)).toEqual([4]);
  });

  it("같은 판정이면 모두 일치하고, 다르면 차이와 치우침을 센다", () => {
    const same = agreement([{ id: "S01", human: humanScored(s01, label()), judge: humanScored(s01, label()), topicsLabeled: true }]);
    expect(same.overall).toMatchObject({ n: 12, exact: 1, within1: 1, meanAbs: 0, bias: 0 });
    expect(same.regenerate).toMatchObject({ truePositive: 1, recall: 1, precision: 1 });

    // 판정기가 시청1을 2단계 후하게, 섹션 3을 다시 만들 섹션으로 더 짚은 경우
    const judge = humanScored(s01, label({ watch1: 5, watch2: [4, 4, 2, 2], engage2: 5 }));
    const human = humanScored(s01, label({ watch1: 3 }));
    const report = agreement([{ id: "S01", human, judge, topicsLabeled: true }]);
    expect(report.families.find((family) => family.family === "시청1")).toMatchObject({ n: 1, exact: 0, within1: 0, bias: 2 });
    expect(report.families.find((family) => family.family === "활동2")).toMatchObject({ bias: 2 });
    expect(report.regenerate).toMatchObject({ truePositive: 1, falsePositive: 1, falseNegative: 0, precision: 0.5 });
  });

  it("스피어만 순위 상관", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 2], [1, 2])).toBeNaN();
  });
});

describe("검토 문서", () => {
  it("대본 전문 다음에 항목마다 단계·이유·감사 의견을 적는다", () => {
    const scored = humanScored(s01, label({ watch2: [4, 4, 3, 1] }));
    const item = scored.watch.items.find((entry) => entry.id === "시청2-4")!;
    item.audit = { verdict: "의심", reason: "새 정보가 조금 있다", suggested_level: 3 };
    const text = formatReview([{ script: s01, run: { scored, opening: cutOpening(s01.sections), structureNotes: [], auditOverall: null } }], "검토");
    expect(text).toContain("## S01 · ");
    expect(text).toContain(`4. [${s01.sections[3]!.role} · ${s01.sections[3]!.seconds}초] ${s01.sections[3]!.narration}`);
    expect(text).toContain("다시 만들 섹션: 4(");
    expect(text).toMatch(/\*\*시청2-4 섹션 4 정보 흥미 · 1\*\*/);
    expect(text).toContain("  - 감사: 3 제안 - 새 정보가 조금 있다");
    expect(text.indexOf("### 대본")).toBeLessThan(text.indexOf("### 판정"));
  });
});

describe("방향 시험", () => {
  const spec = (group: VariantSpec["group"], target: string[]): VariantSpec => ({ id: "S01-X", base: "S01", kind: "X", group, name: "", description: "", target });
  const base = humanScored(s01, label());
  const verdict = (group: VariantSpec["group"], target: string[], overrides: Partial<HumanLabel>) =>
    evaluateVariant(spec(group, target), base, humanScored(s01, label(overrides))).verdict;

  it("결함은 1단계 이상 내려가야, 개선은 1단계 이상 올라가야 통과", () => {
    expect(verdict("결함", ["시청1"], { watch1: 3 })).toBe("통과");
    expect(verdict("결함", ["시청1"], { watch1: 4 })).toBe("실패");
    expect(verdict("결함", ["시청1"], { watch1: null })).toBe("판정 못 함");
    expect(verdict("개선", ["시청2-4"], { watch2: [4, 4, 3, 3] })).toBe("통과");
    expect(verdict("개선", ["시청2-4"], { watch2: [4, 4, 3, 2] })).toBe("실패");
  });

  it("편향은 오르면 실패, 대조는 어느 항목이든 2단계 이상 움직이면 실패", () => {
    expect(verdict("편향", ["활동3"], { engage3: 5 })).toBe("실패");
    expect(verdict("편향", ["활동3"], { engage3: 3 })).toBe("통과");
    expect(verdict("대조", ["*"], { watch1: 3, engage2: 4 })).toBe("통과");
    const moved = evaluateVariant(spec("대조", ["*"]), base, humanScored(s01, label({ watch1: 2 })));
    expect(moved).toMatchObject({ verdict: "실패", bigMoves: ["시청1"], compared: 12 });
    expect(summarizeVariants([moved]).bigMoveRate).toBeCloseTo(1 / 12);
  });

  it("끝에 *를 붙인 대상은 앞부분이 같은 항목 가운데 가장 낮은 단계를 본다", () => {
    expect(targetLevel(humanScored(s01, label({ watch3: [4, 2, 3] })), ["시청3-*"])).toBe(2);
  });
});

describe("점수표", () => {
  it("판정 묶음끼리 대본 ID로 맞춰 비교하고 끝내는 조건과 맞대어 본다", () => {
    const a = [{ id: "S01", scored: humanScored(s01, label()) }];
    const b = [{ id: "S01", scored: humanScored(s01, label({ watch1: 3 })) }];
    const comparison = compare("가", a, "나", b);
    expect(comparison.report.overall).toMatchObject({ n: 12, within1: 1 });
    const list = checks({ version: "v", variants: [], judgeVsRaters: [comparison], raterPairs: [comparison], stability: comparison });
    expect(list.find((check) => check.name === "판정기-판정자 1단계 안")?.pass).toBe(true);
    expect(list.find((check) => check.name === "결함이 내려감")?.pass).toBeNull();
    expect(list.find((check) => check.name === "다시 판정 '다시 만들 섹션' 같음")?.value).toContain("1/1");
  });

  it("참조 판정 파일을 사람 판정 모양으로 읽는다", () => {
    const reference = parseReference({
      rater: "참조A",
      labels: [{ id: "S01", watch1: 4, watch2: [4, 4, 3, 2], watch3: [3, 3, 3], topics: ["없음"], engage2: 3, engage3: 4, affinity1: 3, affinity2: 3, policyRisk: false }],
    });
    expect(reference.labels[0]).toMatchObject({ rater: "참조A", topics: [], watch2: [4, 4, 3, 2] });
  });
});
