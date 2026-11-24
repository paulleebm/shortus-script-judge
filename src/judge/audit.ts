import type { OpeningCut } from "../rules/opening.js";
import type { Script } from "../script.js";
import { ANCHORS, anchorTable, type AnchorKey } from "./anchors.js";
import { renderScript } from "./prompts.js";
import type { AuditAnswer } from "./schemas.js";
import { AUDIT_GAP, finalize, type JudgedItem, type Scored } from "./score.js";

const ANCHOR_OF: Record<string, AnchorKey> = {
  "시청1": "watch1",
  "시청2-": "watch2",
  "시청3-": "watch3",
  "활동2": "engage2",
  "활동3": "engage3",
  "호감1": "affinity1",
  "호감2": "affinity2",
};

function anchorKeyOf(id: string): AnchorKey | undefined {
  const prefix = Object.keys(ANCHOR_OF).find((key) => id.startsWith(key));
  return prefix ? ANCHOR_OF[prefix] : undefined;
}

/** 모든 판정을 한 문서로 모은 정리본. 사람이 읽는 기록이자 감사 호출에 보내는 입력이다. */
export function buildSummary(script: Script, opening: OpeningCut, scored: Scored, structureNotes: string[]): string {
  const groups = [scored.watch, scored.engage, scored.affinity];
  const itemLines = groups.flatMap((group) => [
    `### ${group.name} (묶음 점수 ${group.score ?? "없음"})`,
    ...group.items.map(formatItem),
  ]);

  return [
    `# 판정 정리본: ${script.id}`,
    "",
    "## 대본",
    renderScript(script),
    "",
    `## 첫 3초 (어림 ${opening.spokenSeconds}초, 경계 규칙: ${opening.boundary === "end" ? "3초 안에 끝나는 단어까지" : "3초 안에 시작하는 단어까지"})`,
    opening.text,
    "",
    "## 구성 메모",
    ...(structureNotes.length > 0 ? structureNotes.map((note) => `- ${note}`) : ["- 없음"]),
    "",
    "## 판정 항목",
    ...itemLines,
    "",
    `## 정책 위험: ${scored.policyRisk ? (scored.policyRisk.present ? `있음 (${scored.policyRisk.reason ?? ""})` : "없음") : "판정 못 함"}`,
    "",
    "## 단계 기준표",
    ...(Object.keys(ANCHORS) as AnchorKey[]).flatMap((key) => [`### ${key}`, anchorTable(key)]),
  ].join("\n");
}

function formatItem(item: JudgedItem): string {
  const key = anchorKeyOf(item.id);
  const levelText =
    item.kind === "tag"
      ? "해당"
      : item.level === null
        ? "판정 못 함"
        : `${item.level}단계${key ? ` (${ANCHORS[key][item.level - 1]})` : ""}`;
  return [
    `- [${item.id}] ${item.label}: ${levelText}${item.status === "uncertain" ? " · 불확실" : ""}`,
    ...item.evidence.map((line) => `  - 근거: ${line}`),
    ...(item.reason ? [`  - 이유: ${item.reason}`] : []),
    ...item.notes.map((note) => `  - 메모: ${note}`),
  ].join("\n");
}

/**
 * 감사 결과를 항목에 붙인다. 판정 자체는 고쳐 쓰지 않는다.
 * 단계가 AUDIT_GAP 이상 다르다고 본 항목과 '의심'받은 민감 주제는 '불확실'로 돌려 묶음 점수에서 뺀다.
 */
export function applyAudit(scored: Scored, audit: AuditAnswer | null): Scored {
  const byId = new Map((audit?.items ?? []).map((item) => [item.id, item]));

  const mark = (item: JudgedItem): JudgedItem => {
    if (!audit) return item;
    const found = byId.get(item.id);
    // 감사는 의심인 항목만 적는다. 적지 않은 항목은 타당으로 본다
    if (!found) return { ...item, audit: { verdict: "타당", reason: null, suggested_level: null } };

    const note = { verdict: "의심" as const, reason: found.reason, suggested_level: found.suggested_level };
    const gap = item.level !== null && found.suggested_level !== null ? Math.abs(found.suggested_level - item.level) : 0;
    const demote = item.kind === "tag" || gap >= AUDIT_GAP;
    if (!demote) return { ...item, audit: note };
    return {
      ...item,
      audit: note,
      status: "uncertain",
      notes: [...item.notes, item.kind === "tag" ? "감사에서 의심받아 묶음 점수에서 뺐어요" : `감사가 ${found.suggested_level}단계를 제안해 묶음 점수에서 뺐어요`],
    };
  };

  return finalize({
    watchItems: scored.watch.items.map(mark),
    engageItems: scored.engage.items.map(mark),
    affinityItems: scored.affinity.items.map(mark),
    policyRisk: scored.policyRisk,
  });
}
