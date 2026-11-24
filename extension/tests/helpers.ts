import type { JudgeResponse } from "../../src/api";

/**
 * 쇼더스 2단계 화면의 구조(2026-11-12 기준 클래스 이름)를 흉내 낸 DOM.
 */
export function stepTwo(sections: { role: string; text: string; est: string }[], title = "테스트 대본"): void {
  document.title = `${title} — ShortUs Studio`;
  document.body.innerHTML = `
    <span class="wiz-job-title">${title}</span>
    <div class="script-cols">
      <div class="script-list">
        ${sections
          .map(
            (s, i) => `
          <div class="card script-section">
            <div class="script-section-row">
              <span class="script-role">${s.role}</span>
              <textarea aria-label="${i + 1}번 섹션"></textarea>
              <span class="script-sec-est">${s.est}</span>
            </div>
            <div class="script-sec-bar"><div class="script-sec-actions"></div></div>
          </div>`,
          )
          .join("")}
      </div>
      <div class="script-side"><div class="card script-checklist"></div></div>
    </div>`;
  // textarea 값은 속성이 아니라 value로 넣는다(쇼더스도 그렇다)
  document.querySelectorAll("textarea").forEach((area, i) => (area.value = sections[i]!.text));
}

export const RESULT: JudgeResponse = {
  key: "k1",
  cached: false,
  promptVersion: "test",
  model: "fake",
  groups: { watch: 2, engage: 1.5, affinity: 4 },
  items: [
    { id: "시청2-1", label: "섹션 1 정보 흥미", kind: "level", level: 2, status: "ok", section: 1, reason: "뻔하다", evidence: [] },
    { id: "시청2-2", label: "섹션 2 정보 흥미", kind: "level", level: 4, status: "ok", section: 2, reason: "구체적", evidence: [] },
    { id: "시청3-1→2", label: "섹션 1→2 흐름", kind: "level", level: 3, status: "ok", section: 2, reason: "무난", evidence: [] },
  ],
  regenerate: [{ section: 1, reasons: ["더하는 정보가 약해요"] }],
  policyRisk: { present: false, reason: null },
  audit: { checked: 3, suspicious: 0, overall: null },
  opening: { text: "첫 3초", spokenSeconds: 2.9 },
  costUsd: 0.2,
  elapsedMs: 48000,
  judgedAt: "2026-11-12T00:00:00.000Z",
};
