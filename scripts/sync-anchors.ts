/**
 * DECISIONS.md 8번의 단계 기준표를 src/judge/anchors.ts에서 다시 만든다(CLAUDE.md: 둘은 같아야 한다).
 * 바꾸기 전 표는 docs/iterations.md의 '기준표 이력'에 남긴다. 표시 줄을 찾지 못하면 아무것도 쓰지 않고 멈춘다.
 * 실행: npx tsx scripts/sync-anchors.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ANCHORS, RUBRIC_VERSION } from "../src/judge/anchors.js";

const row = (keys: (keyof typeof ANCHORS)[]) =>
  [1, 2, 3, 4, 5].map((level) => `| ${level} | ${keys.map((key) => ANCHORS[key][level - 1]).join(" | ")} |`).join("\n");
const tables = `| 단계 | 시청1. 첫 3초 궁금증 | 시청2. 섹션이 더하는 정보 | 시청3. 섹션 사이 연결 |
|---|---|---|---|
${row(["watch1", "watch2", "watch3"])}

| 단계 | 활동2. 의견이 갈리는 정도 | 활동3. 감정을 건드리는 정도 | 호감1. 써먹을 수 있는 내용 | 호감2. 기대를 채우는 정도 |
|---|---|---|---|---|
${row(["engage2", "engage3", "affinity1", "affinity2"])}`;

const path = "DECISIONS.md";
const text = readFileSync(path, "utf8");
const start = text.search(/^- 단계 기준\(/m);
const end = text.indexOf("- 묶음 결과(Claude 제안", start);
if (start < 0 || end < 0) throw new Error("DECISIONS.md 8번에서 '- 단계 기준(' 줄이나 '- 묶음 결과(Claude 제안' 줄을 찾지 못했어요. 아무것도 바꾸지 않았어요.");
const old = text.slice(start, end);
const previous = old.match(/기준표 ([\d.-]+)/)?.[1] ?? "이전";
if (previous === RUBRIC_VERSION) {
  console.log(`이미 기준표 ${RUBRIC_VERSION}이에요.`);
  process.exit(0);
}
const header = `- 단계 기준(사람 판정과 LLM 프롬프트에 똑같이 쓴다). 지금 표는 기준표 ${RUBRIC_VERSION}이다(19번 반복 검증에서 고침, \`src/judge/anchors.ts\`와 같다). 앞선 표와 고친 까닭은 \`docs/iterations.md\`에 있다:`;
writeFileSync(path, `${text.slice(0, start)}${header}\n\n${tables}\n\n${text.slice(end)}`, "utf8");

const log = readFileSync("docs/iterations.md", "utf8");
const oldTables = old.slice(old.indexOf("| 단계")).trim();
const entry = `### ${previous}\n\n${oldTables}\n`;
writeFileSync("docs/iterations.md", log.includes("## 기준표 이력") ? `${log.trimEnd()}\n\n${entry}` : `${log.trimEnd()}\n\n## 기준표 이력\n\n${entry}`, "utf8");
console.log(`DECISIONS.md 8번을 기준표 ${RUBRIC_VERSION}로 바꾸고, ${previous} 표를 docs/iterations.md에 남겼어요.`);
