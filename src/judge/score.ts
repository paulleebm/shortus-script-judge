import type { OpeningCut } from "../rules/opening.js";
import type { Script } from "../script.js";
import type { AffinityAnswer, EngagementAnswer, FlowAnswer, OpeningAnswer } from "./schemas.js";
import { isQuoteIn } from "./verify.js";

/** 민감 주제가 하나라도 있으면 활동 점수에 더하는 값. 개발용 세트에서 조정한다(DECISIONS.md 8번). */
export const SENSITIVE_BONUS = 0.5;
/** 이 단계 이하인 섹션은 '다시 만들 섹션'으로 표시한다. */
export const LOW_LEVEL = 2;
/** 감사가 이만큼 이상 다른 단계를 제안하면 그 항목을 '불확실'로 돌린다. */
export const AUDIT_GAP = 2;

export type ItemStatus = "ok" | "uncertain";

export interface AuditNote {
  verdict: "타당" | "의심";
  /** 감사가 적지 않아 타당으로 본 항목은 null */
  reason: string | null;
  suggested_level: number | null;
}

export interface JudgedItem {
  id: string;
  label: string;
  /** level: 1~5 단계가 있는 항목, tag: 민감 주제처럼 해당 여부만 있는 항목 */
  kind: "level" | "tag";
  level: number | null;
  status: ItemStatus;
  section: number | null;
  evidence: string[];
  reason: string;
  notes: string[];
  audit?: AuditNote;
}

export interface Group {
  name: "시청" | "활동" | "호감";
  score: number | null;
  items: JudgedItem[];
}

export interface Scored {
  watch: Group;
  engage: Group;
  affinity: Group;
  policyRisk: { present: boolean; reason: string | null } | null;
  regenerate: { section: number; reasons: string[] }[];
}

export interface Answers {
  opening: OpeningAnswer | null;
  flow: FlowAnswer | null;
  engage: EngagementAnswer | null;
  affinity: AffinityAnswer | null;
}

export function scoreAll(script: Script, opening: OpeningCut, answers: Answers): Scored {
  const watchItems = [
    scoreOpening(script, opening, answers.opening),
    ...scoreSections(script, answers.flow),
    ...scoreTransitions(script, answers.flow),
  ];
  const engageItems = scoreEngagement(script, answers.engage);
  const affinityItems = scoreAffinity(script, opening, answers.affinity);
  const policyRisk = answers.engage ? answers.engage.policy_risk : null;
  return finalize({ watchItems, engageItems, affinityItems, policyRisk });
}

/** 항목 상태가 바뀐 뒤(감사 반영 등) 묶음 점수와 다시 만들 섹션을 다시 계산한다. */
export function finalize(parts: {
  watchItems: JudgedItem[];
  engageItems: JudgedItem[];
  affinityItems: JudgedItem[];
  policyRisk: Scored["policyRisk"];
}): Scored {
  return {
    watch: { name: "시청", score: watchScore(parts.watchItems), items: parts.watchItems },
    engage: { name: "활동", score: engageScore(parts.engageItems), items: parts.engageItems },
    affinity: { name: "호감", score: affinityScore(parts.affinityItems), items: parts.affinityItems },
    policyRisk: parts.policyRisk,
    regenerate: regenerateSections(parts.watchItems),
  };
}

// ---------- 시청 ----------

function scoreOpening(script: Script, opening: OpeningCut, answer: OpeningAnswer | null): JudgedItem {
  const base = { id: "시청1", label: "첫 3초 궁금증", kind: "level" as const, section: 1 };
  if (!answer) return missing(base, "응답을 받지 못했어요");

  const evidence: string[] = [];
  const notes: string[] = [];
  for (const element of answer.elements) {
    if (isQuoteIn(element.quote, script.title, opening.text)) evidence.push(`${element.type}: ${element.quote}`);
    else notes.push(`제목과 첫 3초에서 찾지 못한 인용을 버렸어요: "${element.quote}"`);
  }
  if (answer.level >= 3 && evidence.length === 0) {
    return { ...base, level: null, status: "uncertain", evidence, reason: answer.reason, notes: [...notes, "3단계 이상인데 확인된 근거가 없어요"] };
  }
  return { ...base, level: answer.level, status: "ok", evidence, reason: answer.reason, notes };
}

function scoreSections(script: Script, answer: FlowAnswer | null): JudgedItem[] {
  return script.sections.map((section) => {
    const base = { id: `시청2-${section.order}`, label: `섹션 ${section.order} 정보 흥미`, kind: "level" as const, section: section.order };
    if (!answer) return missing(base, "응답을 받지 못했어요");
    const found = answer.sections.find((item) => item.order === section.order);
    if (!found) return missing(base, "이 섹션의 답이 빠졌어요");
    if (!isQuoteIn(found.quote, section.narration)) {
      return { ...base, level: null, status: "uncertain", evidence: [], reason: found.reason, notes: [`섹션 ${section.order}에서 찾지 못한 인용: "${found.quote}"`] };
    }
    return { ...base, level: found.level, status: "ok", evidence: [found.quote], reason: found.reason, notes: [] };
  });
}

function scoreTransitions(script: Script, answer: FlowAnswer | null): JudgedItem[] {
  const items: JudgedItem[] = [];
  for (let i = 0; i < script.sections.length - 1; i++) {
    const from = script.sections[i]!;
    const to = script.sections[i + 1]!;
    const base = { id: `시청3-${from.order}→${to.order}`, label: `섹션 ${from.order}→${to.order} 흐름`, kind: "level" as const, section: to.order };
    if (!answer) {
      items.push(missing(base, "응답을 받지 못했어요"));
      continue;
    }
    const found = answer.transitions.find((item) => item.from === from.order && item.to === to.order);
    if (!found) {
      items.push(missing(base, "이 연결부의 답이 빠졌어요"));
      continue;
    }
    if (!isQuoteIn(found.quote, from.narration, to.narration)) {
      items.push({ ...base, level: null, status: "uncertain", evidence: [], reason: found.reason, notes: [`두 섹션에서 찾지 못한 인용: "${found.quote}"`] });
      continue;
    }
    items.push({ ...base, level: found.level, status: "ok", evidence: [found.quote], reason: found.reason, notes: [] });
  }
  return items;
}

function watchScore(items: JudgedItem[]): number | null {
  const opening = okLevels(items, "시청1")[0];
  const weakestSection = minOrUndefined(okLevels(items, "시청2-"));
  const weakestTransition = minOrUndefined(okLevels(items, "시청3-"));
  return mean([opening, weakestSection, weakestTransition]);
}

// ---------- 활동 ----------

function scoreEngagement(script: Script, answer: EngagementAnswer | null): JudgedItem[] {
  if (!answer) {
    return [
      missing({ id: "활동2", label: "의견 갈림", kind: "level", section: null }, "응답을 받지 못했어요"),
      missing({ id: "활동3", label: "감정 자극", kind: "level", section: null }, "응답을 받지 못했어요"),
    ];
  }

  const topicItems: JudgedItem[] = [];
  const seenTopics = new Set<string>();
  for (const topic of answer.sensitive_topics) {
    if (!topic.is_central) continue; // 스치듯 언급한 주제는 붙이지 않는다
    const located = locateQuote(script, topic.quote, topic.section);
    if (located === null || seenTopics.has(topic.topic)) continue;
    seenTopics.add(topic.topic);
    topicItems.push({
      id: `활동1-${topic.topic}`,
      label: `민감 주제: ${topic.topic}`,
      kind: "tag",
      level: null,
      status: "ok",
      section: located,
      evidence: [topic.quote],
      reason: topic.reason,
      notes: located === topic.section ? [] : [`섹션 번호를 ${topic.section}에서 ${located}로 바로잡았어요`],
    });
  }

  const issueNotes: string[] = [];
  const emotionNotes: string[] = [];
  const issues = answer.issues.filter((issue) => keepIfLocated(script, issue.quote, issue.section, issueNotes));
  const emotions = answer.emotions.filter((emotion) => keepIfLocated(script, emotion.quote, emotion.section, emotionNotes));
  const harm = answer.harm_structure.present && keepIfLocated(script, answer.harm_structure.quote, answer.harm_structure.section, emotionNotes);
  const twist = answer.twist.present && keepIfLocated(script, answer.twist.quote, answer.twist.section, emotionNotes);

  const engage2: JudgedItem = {
    id: "활동2",
    label: "의견 갈림",
    kind: "level",
    level: engage2Level(issues),
    status: "ok",
    section: null,
    evidence: issues.map(
      (issue) =>
        `${issue.question} — 대본이 제기 ${yesNo(issue.raised_by_script)}, 생각이 갈림 ${yesNo(issue.is_opinion_split)}, 입장 말하기 ${yesNo(issue.can_state_position)}, 양쪽 제시 ${yesNo(issue.shows_both_sides)} ("${issue.quote}")`,
    ),
    reason: "쟁점을 뽑고 예/아니오로 답한 결과를 규칙으로 계산했어요. 대본이 직접 제기한 쟁점만 셌어요",
    notes: issueNotes,
  };
  const engage3: JudgedItem = {
    id: "활동3",
    label: "감정 자극",
    kind: "level",
    level: engage3Level(emotions, harm, twist),
    status: "ok",
    section: null,
    evidence: [
      ...emotions.map((emotion) => `${emotion.emotion}·${emotion.strength} ("${emotion.quote}")`),
      ...(harm ? [`피해 구도 ("${answer.harm_structure.quote}")`] : []),
      ...(twist ? [`반전 ("${answer.twist.quote}")`] : []),
    ],
    reason: "감정 장면과 구도를 뽑은 결과를 규칙으로 계산했어요",
    notes: emotionNotes,
  };
  return [...topicItems, engage2, engage3];
}

export function engage2Level(
  allIssues: { raised_by_script: boolean; is_opinion_split: boolean; can_state_position: boolean; shows_both_sides: boolean }[],
): number {
  const issues = allIssues.filter((issue) => issue.raised_by_script); // 평가자가 떠올린 쟁점은 세지 않는다
  if (issues.length === 0) return 1;
  const opinionIssues = issues.filter((issue) => issue.is_opinion_split && issue.can_state_position);
  if (opinionIssues.length === 0) return 2;
  if (opinionIssues.length >= 2) return 5;
  return opinionIssues[0]!.shows_both_sides ? 4 : 3;
}

export function engage3Level(emotions: { strength: "약" | "강" }[], harm: boolean, twist: boolean): number {
  const strong = emotions.filter((emotion) => emotion.strength === "강").length;
  const weak = emotions.length - strong;
  if (strong >= 2 && harm && twist) return 5;
  if (strong >= 2 || harm) return 4;
  if (strong === 1 || weak >= 2) return 3;
  if (weak === 1) return 2;
  return 1;
}

function engageScore(items: JudgedItem[]): number | null {
  const base = mean([okLevels(items, "활동2")[0], okLevels(items, "활동3")[0]]);
  if (base === null) return null;
  const hasTopic = items.some((item) => item.kind === "tag" && item.status === "ok");
  return round1(Math.min(5, base + (hasTopic ? SENSITIVE_BONUS : 0)));
}

// ---------- 호감 ----------

function scoreAffinity(script: Script, opening: OpeningCut, answer: AffinityAnswer | null): JudgedItem[] {
  if (!answer) {
    return [
      missing({ id: "호감1", label: "써먹을 내용", kind: "level", section: null }, "응답을 받지 못했어요"),
      missing({ id: "호감2", label: "기대 충족", kind: "level", section: null }, "응답을 받지 못했어요"),
    ];
  }

  const droppedNotes: string[] = [];
  const info = answer.useful_info.filter((item) => keepIfLocated(script, item.quote, item.section, droppedNotes));
  const affinity1: JudgedItem = {
    id: "호감1",
    label: "써먹을 내용",
    kind: "level",
    level: affinity1Level(info),
    status: "ok",
    section: null,
    evidence: info.map(
      (item) =>
        `${item.action} — 대부분에게 ${yesNo(item.for_most)}, 상식 ${yesNo(item.is_common_knowledge)}, 구체적 ${yesNo(item.is_specific)} ("${item.quote}")`,
    ),
    reason: "써먹을 정보를 뽑고 예/아니오로 답한 결과를 규칙으로 계산했어요",
    notes: droppedNotes,
  };

  const promise = answer.promise;
  const notes: string[] = [];
  let status: ItemStatus = "ok";
  // 약속은 '제목과 첫 3초'가 만든 기대지만, 근거 구절이 3초 경계에 걸치는 일이 잦아 첫 섹션 전체에서 찾는다.
  if (!isQuoteIn(promise.source_quote, script.title, opening.text, script.sections[0]?.narration)) {
    status = "uncertain";
    notes.push(`약속의 근거 구절을 제목과 첫 섹션에서 찾지 못했어요: "${promise.source_quote}"`);
  }
  const claimsFulfilled = promise.degree === "일부" || promise.degree === "완전" || promise.degree === "초과";
  if (claimsFulfilled && locateQuote(script, promise.fulfilled_quote, promise.fulfilled_section) === null) {
    status = "uncertain";
    notes.push(`약속이 채워졌다는 구절을 대본에서 찾지 못했어요: "${promise.fulfilled_quote ?? ""}"`);
  }
  const affinity2: JudgedItem = {
    id: "호감2",
    label: "기대 충족",
    kind: "level",
    level: status === "ok" ? affinity2Level(promise.degree) : null,
    status,
    section: promise.fulfilled_section,
    evidence: [`약속: ${promise.text} ("${promise.source_quote}")`, ...(promise.fulfilled_quote ? [`채운 곳: "${promise.fulfilled_quote}"`] : [])],
    reason: `채운 정도: ${promise.degree}`,
    notes,
  };
  return [affinity1, affinity2];
}

/**
 * 호감1(2026-11-20.1): 시청자가 할 일이 있는 정보만 센다.
 * 없음 1 · 모두 상식 2 · 상식이 아닌 정보가 있지만 일부에게만 쓸모 있거나 구체적이지 않음 3 ·
 * 대부분에게 쓸모 있고 구체적인 정보 하나 4 · 그런 정보가 둘 이상 5
 */
export function affinity1Level(items: { for_most: boolean; is_common_knowledge: boolean; is_specific: boolean }[]): number {
  if (items.length === 0) return 1;
  const fresh = items.filter((item) => !item.is_common_knowledge);
  if (fresh.length === 0) return 2;
  const actionable = fresh.filter((item) => item.for_most && item.is_specific).length;
  if (actionable >= 2) return 5;
  if (actionable === 1) return 4;
  return 3;
}

const DEGREE_LEVEL: Record<AffinityAnswer["promise"]["degree"], number> = {
  "채우지 않음": 1,
  "관련 이야기만": 2,
  일부: 3,
  완전: 4,
  초과: 5,
};

export function affinity2Level(degree: AffinityAnswer["promise"]["degree"]): number {
  return DEGREE_LEVEL[degree];
}

function affinityScore(items: JudgedItem[]): number | null {
  return mean([okLevels(items, "호감1")[0], okLevels(items, "호감2")[0]]);
}

// ---------- 다시 만들 섹션 ----------

function regenerateSections(watchItems: JudgedItem[]): Scored["regenerate"] {
  const bySection = new Map<number, string[]>();
  for (const item of watchItems) {
    if (item.status !== "ok" || item.level === null || item.level > LOW_LEVEL || item.section === null) continue;
    const reason = item.id === "시청1" ? "첫 3초가 붙잡지 못해요" : item.id.startsWith("시청2-") ? "더하는 정보가 약해요" : "앞 섹션과 자연스럽게 이어지지 않아요";
    bySection.set(item.section, [...(bySection.get(item.section) ?? []), reason]);
  }
  return [...bySection.entries()].sort(([a], [b]) => a - b).map(([section, reasons]) => ({ section, reasons }));
}

// ---------- 도우미 ----------

/** 인용이 지정한 섹션에 있으면 그 번호를, 다른 섹션에 있으면 그 번호를, 어디에도 없으면 null을 돌려준다. */
export function locateQuote(script: Script, quote: string | null, preferred: number | null): number | null {
  if (!quote) return null;
  const preferredSection = script.sections.find((section) => section.order === preferred);
  if (preferredSection && isQuoteIn(quote, preferredSection.narration)) return preferredSection.order;
  return script.sections.find((section) => isQuoteIn(quote, section.narration))?.order ?? null;
}

function keepIfLocated(script: Script, quote: string | null, section: number | null, notes: string[]): boolean {
  if (locateQuote(script, quote, section) !== null) return true;
  notes.push(`대본에서 찾지 못한 인용을 버렸어요: "${quote ?? ""}"`);
  return false;
}

function missing(base: Pick<JudgedItem, "id" | "label" | "kind" | "section">, note: string): JudgedItem {
  return { ...base, level: null, status: "uncertain", evidence: [], reason: "", notes: [note] };
}

function okLevels(items: JudgedItem[], idPrefix: string): number[] {
  return items
    .filter((item) => item.kind === "level" && item.status === "ok" && item.level !== null && item.id.startsWith(idPrefix))
    .map((item) => item.level as number);
}

function minOrUndefined(values: number[]): number | undefined {
  return values.length > 0 ? Math.min(...values) : undefined;
}

function mean(values: (number | undefined)[]): number | null {
  const present = values.filter((value): value is number => value !== undefined);
  if (present.length === 0) return null;
  return round1(present.reduce((sum, value) => sum + value, 0) / present.length);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function yesNo(value: boolean): string {
  return value ? "예" : "아니오";
}
