import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { JudgeRun } from "./judge/index.js";
import type { Group, JudgedItem } from "./judge/score.js";

export function formatConsole(run: JudgeRun): string {
  const { scored } = run;
  const lines = [
    `대본 ${run.scriptId} · ${run.model} · effort ${run.effort}${run.speed === "fast" ? " · 고속" : ""} · 프롬프트 ${run.promptVersion}`,
    `첫 3초: "${run.opening.text}" (어림 ${run.opening.spokenSeconds}초)`,
    ...run.structureNotes.map((note) => `구성: ${note}`),
    "",
    ...formatGroup(scored.watch),
    ...formatGroup(scored.engage),
    ...formatGroup(scored.affinity),
    "",
    `다시 만들 섹션: ${scored.regenerate.length > 0 ? scored.regenerate.map((item) => `${item.section}(${item.reasons.join(", ")})`).join(" / ") : "없음"}`,
    `정책 위험: ${scored.policyRisk ? (scored.policyRisk.present ? `있음 - ${scored.policyRisk.reason ?? ""}` : "없음") : "판정 못 함"}`,
    `감사: ${auditLine(run)}`,
    ...(run.auditOverall ? [`감사 의견: ${run.auditOverall}`] : []),
    `호출 ${run.records.length}회 · 오류 ${run.records.filter((record) => record.error).length}건 · ${(run.elapsedMs / 1000).toFixed(1)}초 · 비용 어림 $${run.costUsd}`,
  ];
  return lines.join("\n");
}

function formatGroup(group: Group): string[] {
  return [`${group.name} ${group.score ?? "판정 못 함"}`, ...group.items.map((item) => `  ${formatItem(item)}`)];
}

function formatItem(item: JudgedItem): string {
  const value = item.kind === "tag" ? "해당" : item.level === null ? "판정 못 함" : `${item.level}`;
  const flags = [
    item.status === "uncertain" ? "불확실" : null,
    item.audit?.verdict === "의심" ? `감사 의심${item.audit.suggested_level ? `(${item.audit.suggested_level} 제안)` : ""}` : null,
  ].filter(Boolean);
  return `${item.id} ${item.label}: ${value}${flags.length > 0 ? ` [${flags.join(", ")}]` : ""}`;
}

function auditLine(run: JudgeRun): string {
  const items = [run.scored.watch, run.scored.engage, run.scored.affinity].flatMap((group) => group.items);
  const audited = items.filter((item) => item.audit);
  if (audited.length === 0) return "결과 없음";
  const suspicious = audited.filter((item) => item.audit?.verdict === "의심");
  return `${audited.length}개 항목 중 의심 ${suspicious.length}개`;
}

/** runs/<대본ID>-<시각>/ 아래에 결과, 요청·응답 전부, 정리본을 남긴다. */
export async function writeRun(run: JudgeRun, outDir: string): Promise<string> {
  const stamp = run.startedAt.replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const dir = join(outDir, `${run.scriptId}-${stamp}`);
  await mkdir(dir, { recursive: true });

  const { records, summary, ...result } = run;
  await writeFile(join(dir, "result.json"), JSON.stringify(result, null, 2), "utf8");
  await writeFile(join(dir, "requests.json"), JSON.stringify(records, null, 2), "utf8");
  await writeFile(join(dir, "summary.md"), `${summary}\n\n${formatAuditSection(run)}\n`, "utf8");
  return dir;
}

function formatAuditSection(run: JudgeRun): string {
  const items = [run.scored.watch, run.scored.engage, run.scored.affinity].flatMap((group) => group.items);
  return [
    "## 감사 결과",
    ...items.map((item) =>
      item.audit
        ? `- [${item.id}] ${item.audit.verdict}${item.audit.suggested_level ? ` (${item.audit.suggested_level}단계 제안)` : ""}${item.audit.reason ? `: ${item.audit.reason}` : ""}`
        : `- [${item.id}] 감사 결과 없음`,
    ),
    "",
    `전체 의견: ${run.auditOverall ?? "없음"}`,
  ].join("\n");
}

/** 다음부터 API 없이 다시 돌릴 수 있게 응답을 fixtures/<대본ID>/ 에 저장한다(같은 대본을 다시 판정한 것은 <대본ID>~2 처럼). */
export async function recordFixtures(run: JudgeRun, fixtureRoot: string, name = run.scriptId): Promise<string> {
  const dir = join(fixtureRoot, name);
  await mkdir(dir, { recursive: true });
  for (const record of run.records) {
    await writeFile(join(dir, `${record.name}.json`), JSON.stringify(record, null, 2), "utf8");
  }
  return dir;
}
