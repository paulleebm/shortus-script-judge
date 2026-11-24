import type { Script } from "../script.js";
import { finalize, type JudgedItem, type Scored } from "../judge/score.js";

/** 판정시트.xlsx '사람 판정' 시트 한 줄 */
export interface HumanLabel {
  id: string;
  rater: string;
  watch1: number | null;
  /** 섹션 순서대로 */
  watch2: (number | null)[];
  /** 1→2 연결부부터 */
  watch3: (number | null)[];
  /** null이면 적지 않음, []이면 '없음' */
  topics: string[] | null;
  engage2: number | null;
  engage3: number | null;
  affinity1: number | null;
  affinity2: number | null;
  policyRisk: boolean | null;
  overall: string | null;
}

/** 머리글이 바뀌어도 앞부분('시청1' 등)으로 찾는다 */
function pick(record: Record<string, string>, prefix: string): string {
  const key = Object.keys(record).find((name) => name.startsWith(prefix));
  return key ? (record[key] ?? "").trim() : "";
}

function level(text: string): number | null {
  if (!text) return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function levels(text: string): (number | null)[] {
  return text ? text.split(/[,\s]+/).filter(Boolean).map(level) : [];
}

/** 단계를 하나라도 적은 줄만 돌려준다 */
export function parseHumanLabels(records: Record<string, string>[]): HumanLabel[] {
  return records
    .map((record): HumanLabel => {
      const topicsText = pick(record, "활동1");
      const policy = pick(record, "정책 위험");
      return {
        id: pick(record, "대본 ID"),
        rater: pick(record, "판정자"),
        watch1: level(pick(record, "시청1")),
        watch2: levels(pick(record, "시청2")),
        watch3: levels(pick(record, "시청3")),
        topics: topicsText ? topicsText.split(/[,\s]+/).filter((topic) => topic && topic !== "없음") : null,
        engage2: level(pick(record, "활동2")),
        engage3: level(pick(record, "활동3")),
        affinity1: level(pick(record, "호감1")),
        affinity2: level(pick(record, "호감2")),
        policyRisk: policy === "예" ? true : policy === "아니오" ? false : null,
        overall: pick(record, "전체") || null,
      };
    })
    .filter(
      (label) =>
        label.id &&
        [label.watch1, label.engage2, label.engage3, label.affinity1, label.affinity2, ...label.watch2, ...label.watch3].some((value) => value !== null),
    );
}

function item(id: string, label: string, value: number | null, section: number | null): JudgedItem {
  return { id, label, kind: "level", level: value, status: value === null ? "uncertain" : "ok", section, evidence: [], reason: "", notes: [] };
}

/**
 * 사람 판정을 판정기와 같은 모양으로 바꾼다. 묶음 점수와 다시 만들 섹션도 판정기와 같은 코드(finalize)로 계산한다.
 * 그래서 묶음 점수 차이는 '계산 규칙'이 아니라 '항목 판단'의 차이만 보여 준다.
 */
export function humanScored(script: Script, label: HumanLabel): Scored {
  const sections = script.sections;
  const watchItems = [
    item("시청1", "첫 3초 궁금증", label.watch1, 1),
    ...sections.map((section, index) => item(`시청2-${section.order}`, `섹션 ${section.order} 정보 흥미`, label.watch2[index] ?? null, section.order)),
    ...sections.slice(0, -1).map((section, index) => {
      const next = sections[index + 1]!;
      return item(`시청3-${section.order}→${next.order}`, `섹션 ${section.order}→${next.order} 흐름`, label.watch3[index] ?? null, next.order);
    }),
  ];
  const topics: JudgedItem[] = (label.topics ?? []).map((topic) => ({
    id: `활동1-${topic}`,
    label: `민감 주제: ${topic}`,
    kind: "tag",
    level: null,
    status: "ok",
    section: null,
    evidence: [],
    reason: "",
    notes: [],
  }));
  return finalize({
    watchItems,
    engageItems: [...topics, item("활동2", "의견 갈림", label.engage2, null), item("활동3", "감정 자극", label.engage3, null)],
    affinityItems: [item("호감1", "써먹을 내용", label.affinity1, null), item("호감2", "기대 충족", label.affinity2, null)],
    policyRisk: label.policyRisk === null ? null : { present: label.policyRisk, reason: null },
  });
}
