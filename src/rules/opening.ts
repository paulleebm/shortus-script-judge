import type { Section } from "../script.js";
import { countSpokenSyllables } from "./syllables.js";

/**
 * 경계에 걸친 단어를 어떻게 셀지.
 * - end: 3초 안에 끝까지 들리는 단어만 넣는다(기본값)
 * - start: 3초 안에 시작하는 단어까지 넣는다
 */
export type Boundary = "end" | "start";

export interface OpeningCut {
  text: string;
  windowSeconds: number;
  boundary: Boundary;
  /** 잘라 낸 말이 실제로 들리는 데 걸리는 어림 시간 */
  spokenSeconds: number;
  /** 잘라 낸 말이 걸쳐 있는 마지막 섹션 번호 */
  lastSection: number;
}

/**
 * 섹션별 표시 초를 음절 수로 나눠 말하는 속도를 구하고, 앞에서부터 windowSeconds만큼 잘라 낸다.
 * 섹션 안에서는 말하는 속도가 고르다고 본다.
 */
export function cutOpening(sections: Section[], windowSeconds = 3, boundary: Boundary = "end"): OpeningCut {
  const kept: string[] = [];
  let elapsed = 0;
  let lastSection = sections[0]?.order ?? 1;

  outer: for (const section of sections) {
    const words = section.narration.split(/\s+/).filter(Boolean);
    const sectionSyllables = words.reduce((sum, word) => sum + countSpokenSyllables(word), 0);
    const secondsPerSyllable = sectionSyllables > 0 ? section.seconds / sectionSyllables : 0;

    for (const word of words) {
      const duration = countSpokenSyllables(word) * secondsPerSyllable;
      const fits = boundary === "end" ? elapsed + duration <= windowSeconds + 1e-9 : elapsed < windowSeconds;
      if (!fits) break outer;
      kept.push(word);
      elapsed += duration;
      lastSection = section.order;
    }
  }

  const firstWord = sections[0]?.narration.split(/\s+/).find(Boolean);
  if (kept.length === 0 && firstWord) kept.push(firstWord);

  return { text: kept.join(" "), windowSeconds, boundary, spokenSeconds: round(elapsed, 2), lastSection };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
