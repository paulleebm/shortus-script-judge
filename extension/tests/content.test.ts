// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fingerprint, parseSeconds, readScript } from "../src/dom";
import { renderInlineChips, renderSideCard } from "../src/ui";
import { RESULT, stepTwo } from "./helpers";

describe("2단계 화면 읽기", () => {
  beforeEach(() => stepTwo([
    { role: "훅", text: "첫 문장이에요.", est: "약 6.4초" },
    { role: "통계", text: "숫자가 나와요.", est: "약 9.0초" },
  ]));

  it("제목, 역할, 내레이션, 예상 초를 읽는다", () => {
    expect(readScript(document)).toEqual({
      title: "테스트 대본",
      sections: [
        { order: 1, role: "훅", narration: "첫 문장이에요.", seconds: 6.4 },
        { order: 2, role: "통계", narration: "숫자가 나와요.", seconds: 9 },
      ],
    });
  });

  it("2단계 화면이 아니면 아무것도 읽지 않는다", () => {
    document.body.innerHTML = "<main>다른 단계</main>";
    expect(readScript(document)).toBeNull();
  });

  it("섹션 글이 바뀌면 지문이 바뀐다", () => {
    const before = fingerprint(readScript(document)!);
    document.querySelector("textarea")!.value = "고친 문장이에요.";
    expect(fingerprint(readScript(document)!)).not.toBe(before);
  });

  it("'약 N초'에서 초를 읽는다", () => {
    expect(parseSeconds("약 10.3초")).toBe(10.3);
    expect(parseSeconds("없음")).toBe(0);
  });
});

describe("판정 결과 그리기", () => {
  beforeEach(() => stepTwo([
    { role: "훅", text: "첫 문장이에요.", est: "약 6.4초" },
    { role: "포인트", text: "둘째 문장이에요.", est: "약 7.0초" },
  ]));

  it("'확정 준비' 카드 바로 아래에 판정 카드를 넣고 점수와 다시 만들 섹션을 보여 준다", () => {
    const onSection = vi.fn();
    renderSideCard(document, { phase: "result", result: RESULT, stale: false }, { canRun: true, onRun: vi.fn(), onSection });
    const card = document.querySelector<HTMLElement>("[data-sj='card']")!;
    expect(card.previousElementSibling?.classList.contains("script-checklist")).toBe(true);
    expect(card.textContent).toContain("시청");
    expect(card.textContent).toContain("2.0");
    card.querySelector<HTMLButtonElement>(".sj-sec")!.click();
    expect(onSection).toHaveBeenCalledWith(1);
  });

  it("같은 상태로 다시 그려도 카드를 새로 만들지 않는다", () => {
    const state = { phase: "result" as const, result: RESULT, stale: false };
    renderSideCard(document, state, { canRun: true, onRun: vi.fn(), onSection: vi.fn() });
    const first = document.querySelector("[data-sj='card'] .sj-run");
    renderSideCard(document, state, { canRun: true, onRun: vi.fn(), onSection: vi.fn() });
    expect(document.querySelector("[data-sj='card'] .sj-run")).toBe(first);
  });

  it("판정 결과의 글은 HTML로 해석하지 않는다", () => {
    const evil = { ...RESULT, key: "k2", regenerate: [{ section: 1, reasons: ["<img src=x onerror=alert(1)>"] }] };
    renderSideCard(document, { phase: "result", result: evil, stale: false }, { canRun: true, onRun: vi.fn(), onSection: vi.fn() });
    expect(document.querySelector("[data-sj='card'] img")).toBeNull();
  });

  it("섹션마다 정보 흥미와 흐름 칩을 붙이고, 낮은 단계는 경고색으로 표시한다", () => {
    renderInlineChips(document, RESULT);
    const chips = [...document.querySelectorAll("[data-sj='chips']")];
    expect(chips[0]!.textContent).toBe("정보 흥미 2");
    expect(chips[0]!.querySelector(".sj-chip")!.classList.contains("warn")).toBe(true);
    expect(chips[1]!.textContent).toBe("정보 흥미 4앞과의 흐름 3");
    renderInlineChips(document, null);
    expect(document.querySelector("[data-sj='chips']")).toBeNull();
  });
});
