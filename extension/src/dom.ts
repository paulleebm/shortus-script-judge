import type { JudgeRequest } from "../../src/api";

/**
 * 쇼더스 2단계('대본과 나레이션') 화면에서 대본을 읽는다.
 * 쇼더스 화면의 클래스 이름(2026-11-12 기준)에 기대므로, 화면이 바뀌면 이 파일만 고치면 된다.
 */
export const SELECTORS = {
  title: ".wiz-job-title",
  section: ".card.script-section",
  role: ".script-role",
  narration: "textarea",
  estimate: ".script-sec-est",
  sectionBar: ".script-sec-bar",
  side: ".script-side",
  checklist: ".card.script-checklist",
} as const;

export function isScriptStep(doc: Document): boolean {
  return doc.querySelector(SELECTORS.checklist) !== null && doc.querySelector(SELECTORS.section) !== null;
}

export function readScript(doc: Document): JudgeRequest | null {
  if (!isScriptStep(doc)) return null;
  const title = doc.querySelector(SELECTORS.title)?.textContent?.trim() || doc.title.replace(/ — ShortUs Studio$/, "").trim();
  const sections = [...doc.querySelectorAll<HTMLElement>(SELECTORS.section)].map((card, index) => ({
    order: index + 1,
    role: card.querySelector(SELECTORS.role)?.textContent?.trim() || "기타",
    narration: (card.querySelector<HTMLTextAreaElement>(SELECTORS.narration)?.value ?? "").trim(),
    seconds: parseSeconds(card.querySelector(SELECTORS.estimate)?.textContent ?? ""),
  }));
  if (!title || sections.length < 2 || sections.some((section) => !section.narration || section.seconds <= 0)) return null;
  return { title, sections };
}

/** "약 6.4초" → 6.4 */
export function parseSeconds(text: string): number {
  const match = text.match(/(\d+(?:\.\d+)?)\s*초/);
  return match ? Number(match[1]) : 0;
}

/** 대본이 바뀌었는지 알아보는 짧은 지문(서버의 캐시 키와는 따로 쓴다) */
export function fingerprint(request: JudgeRequest): string {
  const text = JSON.stringify(request);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
