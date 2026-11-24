import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FLOW_SAMPLES, judgeScript, mergeFlow } from "../src/judge/index.js";
import { createReplayCaller } from "../src/judge/llm.js";
import { recordFixtures } from "../src/report.js";
import { ScriptSchema } from "../src/script.js";
import { FAKE_ANSWERS, fakeCaller } from "./helpers/fake-judge.js";

/**
 * 판정 흐름 시험. LLM 응답은 테스트용으로 손으로 만든 가짜다(실제 모델 응답이 아님).
 * 확인하는 것: 묶음 호출 4개가 동시에 나가는지, 인용 대조, 단계 계산, 감사 반영.
 */
const script = ScriptSchema.parse(JSON.parse(readFileSync("data/scripts/S00.json", "utf8")));


describe("판정 흐름", () => {
  it("묶음 호출 4개(시청2·3은 FLOW_SAMPLES번)를 동시에 보내고, 감사는 그 뒤에 한 번 보낸다", async () => {
    const { caller, started } = fakeCaller(FAKE_ANSWERS);
    const run = await judgeScript(script, caller);
    const flows = Array.from({ length: FLOW_SAMPLES }, (_, index) => (index === 0 ? "watch2-3-flow" : `watch2-3-flow#${index + 1}`));
    expect(started.slice(0, 3 + FLOW_SAMPLES).sort()).toEqual(["affinity", "engage-activity", "watch1-opening", ...flows].sort());
    expect(started[3 + FLOW_SAMPLES]).toBe("audit-fairness");
    expect(run.records).toHaveLength(4 + FLOW_SAMPLES);
  });

  it("첫 3초 질문에는 제목과 잘라 낸 첫 3초만 보낸다", async () => {
    const { caller } = fakeCaller(FAKE_ANSWERS);
    const run = await judgeScript(script, caller);
    const openingRequest = run.records.find((record) => record.name === "watch1-opening")!.request.user;
    expect(openingRequest).toContain("첫 3초: 엔비디아 CEO 젠슨 황이 스파이 의혹");
    expect(openingRequest).not.toContain("이사회의 독립 조사");
  });

  it("대본에 없는 인용은 버리고 기록을 남긴다", async () => {
    const { caller } = fakeCaller(FAKE_ANSWERS);
    const run = await judgeScript(script, caller);
    const opening = run.scored.watch.items.find((item) => item.id === "시청1")!;
    expect(opening.evidence).toEqual(["갈등: 스파이 의혹"]);
    expect(opening.notes.some((note) => note.includes("충격적인 반전"))).toBe(true);
  });

  it("단계를 규칙으로 계산한다", async () => {
    const { caller } = fakeCaller(FAKE_ANSWERS);
    const { before } = await judgeScript(script, caller);
    const level = (id: string) => [...before.watch.items, ...before.engage.items, ...before.affinity.items].find((item) => item.id === id)?.level;
    expect(level("활동2")).toBe(4); // 대본이 제기한 쟁점 하나 + 양쪽 제시. 떠올린 쟁점은 세지 않는다
    expect(before.engage.items.filter((item) => item.kind === "tag").map((item) => item.id)).toEqual(["활동1-유명인"]);
    expect(level("활동3")).toBe(3); // 강한 장면 하나
    expect(before.engage.score).toBe(4); // (4 + 3) / 2 + 민감 주제 0.5
    expect(level("호감1")).toBe(1);
    expect(level("호감2")).toBe(4);
    expect(before.affinity.score).toBe(2.5);
    expect(before.watch.score).toBe(2.7); // (시청1 4 + 가장 낮은 섹션 2 + 가장 낮은 연결부 2) / 3
  });

  it("감사가 2단계 이상 다르게 본 항목은 불확실로 돌리고 점수를 다시 계산한다", async () => {
    const { caller } = fakeCaller(FAKE_ANSWERS);
    const run = await judgeScript(script, caller);
    const section2 = run.scored.watch.items.find((item) => item.id === "시청2-2")!;
    expect(section2.status).toBe("uncertain");
    expect(section2.level).toBe(2); // 판정 자체는 고쳐 쓰지 않는다
    expect(run.scored.watch.score).toBe(3); // (4 + 3 + 2) / 3
    expect(run.scored.regenerate).toEqual([{ section: 2, reasons: ["앞 섹션과 자연스럽게 이어지지 않아요"] }]);
  });

  it("감사가 적지 않은 항목은 타당으로 보고, 감사를 받지 못하면 아무 표시도 붙이지 않는다", async () => {
    const run = await judgeScript(script, fakeCaller(FAKE_ANSWERS).caller);
    const items = [run.scored.watch, run.scored.engage, run.scored.affinity].flatMap((group) => group.items);
    expect(items.find((item) => item.id === "시청2-2")!.audit).toMatchObject({ verdict: "의심", suggested_level: 4 });
    const others = items.filter((item) => item.id !== "시청2-2");
    expect(others.every((item) => item.audit?.verdict === "타당" && item.audit.reason === null)).toBe(true);
    expect(others.every((item) => item.notes.every((note) => !note.includes("감사")))).toBe(true);

    const { "audit-fairness": _omit, ...withoutAudit } = FAKE_ANSWERS;
    const unaudited = await judgeScript(script, fakeCaller(withoutAudit).caller);
    const all = [unaudited.scored.watch, unaudited.scored.engage, unaudited.scored.affinity].flatMap((group) => group.items);
    expect(all.every((item) => item.audit === undefined)).toBe(true);
  });

  it("저장한 응답으로 다시 돌리면 같은 결과가 나오고, 요청이 바뀌면 멈춘다", async () => {
    const { caller } = fakeCaller(FAKE_ANSWERS);
    const first = await judgeScript(script, caller);
    const fixtureRoot = mkdtempSync(join(tmpdir(), "judge-fixtures-"));
    const dir = await recordFixtures(first, fixtureRoot);

    const replayed = await judgeScript(script, createReplayCaller(dir, "fake", "medium"));
    expect(replayed.scored).toEqual(first.scored);

    const changed = ScriptSchema.parse({ ...script, title: "다른 제목" });
    await expect(judgeScript(changed, createReplayCaller(dir, "fake", "medium"))).rejects.toThrow("저장된 응답이 지금 요청과 달라요");
  });

  it("약속의 근거 구절이 첫 3초를 넘어 첫 섹션에 있어도 받아들인다", async () => {
    const affinity = FAKE_ANSWERS.affinity as { promise: Record<string, unknown> };
    const answers = {
      ...FAKE_ANSWERS,
      affinity: { ...affinity, promise: { ...affinity.promise, source_quote: "스파이 의혹 여성과의 외도를 인정하면서" } },
    };
    const { caller } = fakeCaller(answers);
    const { before } = await judgeScript(script, caller);
    const promise = before.affinity.items.find((item) => item.id === "호감2")!;
    expect(promise.status).toBe("ok");
    expect(promise.level).toBe(4);
  });

  it("응답을 못 받은 묶음은 판정 못 함으로 남긴다", async () => {
    const { affinity: _omit, ...withoutAffinity } = FAKE_ANSWERS;
    const { caller } = fakeCaller(withoutAffinity);
    const run = await judgeScript(script, caller);
    expect(run.scored.affinity.score).toBeNull();
    expect(run.scored.affinity.items.every((item) => item.status === "uncertain")).toBe(true);
  });
});

describe("시청2·3 여러 번 묻기", () => {
  const answer = (levels: number[], transitionLevels: number[]) => ({
    sections: levels.map((level, index) => ({ order: index + 1, quote: `q${index + 1}-${level}`, reason: `r${level}`, level })),
    transitions: transitionLevels.map((level, index) => ({ from: index + 1, to: index + 2, quote: `t${index + 1}-${level}`, reason: `r${level}`, level })),
  });

  it("항목마다 가운데값을 쓰고, 인용과 이유는 그 단계를 준 답에서 가져온다", () => {
    const merged = mergeFlow([answer([2, 4], [3]), answer([3, 4], [2]), null, answer([3, 1], [2])]);
    expect(merged?.sections.map((entry) => entry.level)).toEqual([3, 4]);
    expect(merged?.sections[0]?.quote).toBe("q1-3");
    expect(merged?.transitions.map((entry) => entry.level)).toEqual([2]);
  });

  it("답이 하나뿐이면 그대로 쓴다", () => {
    const single = answer([2, 4], [3]);
    expect(mergeFlow([single, null])).toBe(single);
    expect(mergeFlow([null])).toBeNull();
  });
});
