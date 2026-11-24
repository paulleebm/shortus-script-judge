import { describe, expect, it } from "vitest";
import { cutOpening } from "../src/rules/opening.js";
import { countIntegerSyllables, countNumberSyllables, countSpokenSyllables } from "../src/rules/syllables.js";
import type { Section } from "../src/script.js";

describe("음절 어림", () => {
  it.each([
    ["2026", 5], // 이천이십육
    ["50", 2], // 오십
    ["10", 1], // 십
    ["1313", 5], // 천삼백십삼
    ["10000", 1], // 만
    ["0", 1], // 영
  ])("정수 %s → %i음절", (digits, expected) => {
    expect(countIntegerSyllables(digits)).toBe(expected);
  });

  it("소수점과 자릿수 쉼표를 읽는다", () => {
    expect(countNumberSyllables("3.58")).toBe(4); // 삼점오팔
    expect(countNumberSyllables("1,313")).toBe(5);
  });

  it("한글, 영문 약어, 퍼센트를 함께 센다", () => {
    expect(countSpokenSyllables("엔비디아 CEO 젠슨 황이")).toBe(11);
    expect(countSpokenSyllables("3.58%")).toBe(7);
    expect(countSpokenSyllables("…!?")).toBe(0);
  });
});

const hook: Section = {
  order: 1,
  role: "훅",
  narration: "엔비디아 CEO 젠슨 황이 스파이 의혹 여성과의 외도를 인정하면서 이사회의 독립 조사에 들어갔습니다.",
  seconds: 8.0,
};

describe("첫 3초 잘라 내기", () => {
  it("기본값은 3초 안에 끝나는 단어까지 넣는다", () => {
    const cut = cutOpening([hook]);
    expect(cut.text).toBe("엔비디아 CEO 젠슨 황이 스파이 의혹");
    expect(cut.spokenSeconds).toBeLessThanOrEqual(3);
  });

  it("start 규칙은 3초 안에 시작하는 단어까지 넣는다", () => {
    expect(cutOpening([hook], 3, "start").text).toBe("엔비디아 CEO 젠슨 황이 스파이 의혹 여성과의");
  });

  it("첫 섹션이 3초보다 짧으면 다음 섹션으로 이어서 자른다", () => {
    const short: Section = { order: 1, role: "훅", narration: "잘릴까?", seconds: 1 };
    const next: Section = { order: 2, role: "포인트", narration: "이사회가 표결을 앞두고 있습니다", seconds: 4 };
    const cut = cutOpening([short, next]);
    expect(cut.text.startsWith("잘릴까? 이사회가")).toBe(true);
    expect(cut.lastSection).toBe(2);
  });
});
