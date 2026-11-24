import { describe, expect, it } from "vitest";
import { affinity1Level, affinity2Level, engage2Level, engage3Level } from "../src/judge/score.js";
import { isQuoteIn } from "../src/judge/verify.js";

const issue = (is_opinion_split: boolean, can_state_position: boolean, shows_both_sides: boolean, raised_by_script = true) => ({
  raised_by_script,
  is_opinion_split,
  can_state_position,
  shows_both_sides,
});

describe("활동2 의견 갈림 단계", () => {
  it.each([
    [[], 1],
    [[issue(false, true, true)], 2],
    [[issue(true, false, true)], 2],
    [[issue(true, true, false)], 3],
    [[issue(true, true, true)], 4],
    [[issue(true, true, false), issue(true, true, false)], 5],
  ])("%j → %i", (issues, expected) => {
    expect(engage2Level(issues)).toBe(expected);
  });

  it("대본이 직접 제기하지 않은 쟁점은 세지 않는다", () => {
    expect(engage2Level([issue(true, true, true, false)])).toBe(1);
    expect(engage2Level([issue(true, true, true), issue(true, true, true, false)])).toBe(4);
  });
});

describe("활동3 감정 자극 단계", () => {
  const strong = { strength: "강" as const };
  const weak = { strength: "약" as const };
  it.each([
    [[], false, false, 1],
    [[weak], false, false, 2],
    [[weak, weak], false, false, 3],
    [[strong], false, false, 3],
    [[strong, strong], false, false, 4],
    [[weak], true, false, 4],
    [[strong, strong], true, true, 5],
    [[strong], true, true, 4],
  ])("%j, 피해 구도 %s, 반전 %s → %i", (emotions, harm, twist, expected) => {
    expect(engage3Level(emotions, harm, twist)).toBe(expected);
  });
});

describe("호감 단계", () => {
  const info = (for_most: boolean, is_common_knowledge: boolean, is_specific: boolean) => ({ for_most, is_common_knowledge, is_specific });
  it.each([
    [[], 1],
    [[info(true, true, true)], 2],
    [[info(false, false, true)], 3],
    [[info(true, false, false)], 3],
    [[info(true, false, true)], 4],
    [[info(true, false, true), info(true, true, true)], 4],
    [[info(true, false, true), info(true, false, true)], 5],
  ])("호감1 %j → %i", (items, expected) => {
    expect(affinity1Level(items)).toBe(expected);
  });

  it("호감2는 채운 정도를 단계로 바꾼다", () => {
    expect(affinity2Level("채우지 않음")).toBe(1);
    expect(affinity2Level("완전")).toBe(4);
    expect(affinity2Level("초과")).toBe(5);
  });
});

describe("인용 대조", () => {
  const narration = "황은 다른 빅테크 창업자와 달리 차등의결권이 없고 지분도 3.58퍼센트뿐이라";
  it("띄어쓰기와 문장부호 차이는 무시한다", () => {
    expect(isQuoteIn("차등의결권이 없고  지분도 3.58퍼센트뿐", narration)).toBe(true);
    expect(isQuoteIn("“빅테크 창업자와 달리”", narration)).toBe(true);
  });
  it("대본에 없는 말은 걸러 낸다", () => {
    expect(isQuoteIn("지분이 10퍼센트", narration)).toBe(false);
    expect(isQuoteIn("", narration)).toBe(false);
    expect(isQuoteIn(null, narration)).toBe(false);
  });
});
