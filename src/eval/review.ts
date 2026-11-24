import type { JudgeRun } from "../judge/index.js";
import type { Group, JudgedItem } from "../judge/score.js";
import { totalSeconds, type Script } from "../script.js";

export type ReviewRun = Pick<JudgeRun, "scored" | "opening" | "structureNotes" | "auditOverall">;

/**
 * 사람이 판정기 결과를 읽고 이의를 다는 검토 문서. 대본 전문 → 판정(단계·이유·근거·감사) 순서로,
 * 대본을 먼저 읽고 판정을 대조하게 한다.
 */
export function formatReview(entries: { script: Script; run: ReviewRun }[], title: string): string {
  return [
    `# ${title}`,
    "",
    "대본마다 판정을 보고 이상한 항목만 '대본 ID · 항목 · 생각하는 단계 · 이유'로 알려 주세요. 다 봤는데 이상한 것이 없으면 '이의 없음'이라고 알려 주세요.",
    "",
    ...entries.flatMap(({ script, run }) => formatScript(script, run)),
  ].join("\n");
}

function formatScript(script: Script, run: ReviewRun): string[] {
  const { scored } = run;
  const source = script.source ? `${script.source.type}${script.source.title ? ` · ${script.source.title}` : ""}` : "원문 정보 없음";
  const regenerate =
    scored.regenerate.length > 0 ? scored.regenerate.map((item) => `${item.section}(${item.reasons.join(", ")})`).join(" / ") : "없음";
  const policy = scored.policyRisk ? (scored.policyRisk.present ? `있음 - ${scored.policyRisk.reason ?? ""}` : "없음") : "판정 못 함";
  return [
    `## ${script.id} · ${script.title}`,
    "",
    `- 원문: ${source}`,
    `- 섹션 ${script.sections.length}개 · ${Math.round(totalSeconds(script))}초`,
    `- **${groupLine(scored.watch)} · ${groupLine(scored.engage)} · ${groupLine(scored.affinity)}**`,
    `- 다시 만들 섹션: ${regenerate}`,
    `- 정책 위험: ${policy}`,
    ...run.structureNotes.map((note) => `- 구성: ${note}`),
    "",
    "### 대본",
    "",
    `첫 3초(어림 ${run.opening.spokenSeconds}초): "${run.opening.text}"`,
    "",
    ...script.sections.map((section) => `${section.order}. [${section.role} · ${section.seconds}초] ${section.narration}`),
    "",
    "### 판정",
    "",
    ...[scored.watch, scored.engage, scored.affinity].flatMap(formatGroup),
    `감사 의견: ${run.auditOverall ?? "없음"}`,
    "",
  ];
}

function groupLine(group: Group): string {
  return `${group.name} ${group.score ?? "판정 못 함"}`;
}

function formatGroup(group: Group): string[] {
  return [`**${group.name}**`, "", ...group.items.flatMap(formatItem), ""];
}

function formatItem(item: JudgedItem): string[] {
  const value = item.kind === "tag" ? "해당" : (item.level ?? "판정 못 함");
  const lines = [`- **${item.id} ${item.label} · ${value}**${item.status === "uncertain" ? " (불확실)" : ""} ${item.reason}`];
  if (item.evidence.length > 0) lines.push(`  - 근거: ${item.evidence.map((quote) => `"${quote}"`).join(" / ")}`);
  for (const note of item.notes) lines.push(`  - 확인: ${note}`);
  if (item.audit?.verdict === "의심") {
    const suggested = item.audit.suggested_level ? `${item.audit.suggested_level} 제안` : "의심";
    lines.push(`  - 감사: ${suggested}${item.audit.reason ? ` - ${item.audit.reason}` : ""}`);
  }
  return lines;
}
