import { totalSeconds, type Script } from "../script.js";

/**
 * 판정 기준은 아니지만 결과를 읽을 때 알아 둘 구성 정보.
 * 시청·활동·호감 점수에는 영향을 주지 않는다.
 */
export function checkStructure(script: Script): string[] {
  const notes: string[] = [];
  const first = script.sections[0];
  const last = script.sections[script.sections.length - 1];

  if (first && first.role !== "훅") notes.push(`첫 섹션의 역할이 '훅'이 아니라 '${first.role}'예요.`);
  if (last && last.role !== "행동 유도") notes.push(`마지막 섹션의 역할이 '행동 유도'가 아니라 '${last.role}'예요.`);

  const seconds = totalSeconds(script);
  if (seconds < 30 || seconds > 45) notes.push(`러닝타임 ${seconds.toFixed(1)}초가 30~45초 밖이에요.`);

  return notes;
}
