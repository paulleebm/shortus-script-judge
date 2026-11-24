// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { JudgeRequest, JudgeResponse } from "../../src/api";
import { RESULT, stepTwo } from "./helpers";

/**
 * content.ts 전체 흐름. 백그라운드는 가짜 chrome.runtime으로 바꿔 끼우고, 답을 언제 줄지 시험에서 정한다.
 * content.ts는 불러오는 순간 화면을 지켜보기 시작하므로 한 번만 불러오고, 아래 시험은 차례대로 이어진다.
 */
type Reply = { ok: true; result: JudgeResponse } | { ok: false; status: number; message: string } | { wait: true };
/** reply: 백그라운드의 답, drop: 백그라운드가 답 없이 멈춰 포트가 끊김 */
type Sent = { request: JudgeRequest; cacheOnly: boolean; reply: (r: Reply) => void; drop: () => void };

const sent: Sent[] = [];
const NOT_CACHED: Reply = { ok: false, status: 404, message: "저장된 판정이 없어요." };

vi.stubGlobal("chrome", {
  runtime: {
    connect: () => {
      const onMessage: ((r: Reply) => void)[] = [];
      const onDisconnect: (() => void)[] = [];
      return {
        onMessage: { addListener: (fn: (r: Reply) => void) => onMessage.push(fn) },
        onDisconnect: { addListener: (fn: () => void) => onDisconnect.push(fn) },
        disconnect: () => {},
        postMessage: (msg: { request: JudgeRequest; cacheOnly: boolean }) =>
          sent.push({
            ...msg,
            reply: (r) => onMessage.forEach((fn) => fn(r)),
            drop: () => onDisconnect.forEach((fn) => fn()),
          }),
      };
    },
  },
});

const SECTIONS = [
  { role: "훅", text: "첫 문장이에요.", est: "약 6.4초" },
  { role: "포인트", text: "둘째 문장이에요.", est: "약 7.0초" },
];

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const card = () => document.querySelector<HTMLElement>("[data-sj='card']")!;
const last = () => sent[sent.length - 1]!;

async function goTo(hash: string): Promise<void> {
  history.replaceState(null, "", hash);
  document.dispatchEvent(new Event("input"));
  await settle();
}

beforeAll(async () => {
  history.replaceState(null, "", "#/shorts/a?step=2");
  stepTwo(SECTIONS);
  await import("../src/content");
  await settle();
});

describe("확장 프로그램 흐름", () => {
  it("처음 보는 대본은 저장된 결과만 묻고, 없으면 판정하기 버튼을 둔다", async () => {
    expect(sent.map((s) => s.cacheOnly)).toEqual([true]);
    last().reply(NOT_CACHED);
    await settle();
    expect(card().textContent).toContain("판정하기");
  });

  it("판정하기를 누르면 판정 중으로 바뀌고, 기다리는 신호에는 그대로 있다가 답이 오면 점수를 보여 준다", async () => {
    card().querySelector<HTMLButtonElement>(".sj-run")!.click();
    await settle();
    expect(last().cacheOnly).toBe(false);
    expect(card().textContent).toContain("판정 중");
    last().reply({ wait: true });
    await settle();
    expect(card().textContent).toContain("판정 중");
    last().reply({ ok: true, result: RESULT });
    await settle();
    expect(card().textContent).toContain("1.5");
    expect(document.querySelectorAll("[data-sj='chips']")).toHaveLength(2);
  });

  it("백그라운드가 답 없이 끊기면 같은 요청을 다시 보내고, 그 답으로 결과를 보여 준다", async () => {
    await goTo("#/shorts/retry?step=2");
    last().reply(NOT_CACHED);
    card().querySelector<HTMLButtonElement>(".sj-run")!.click();
    await settle();
    const first = last();
    first.drop();
    await settle();
    const retry = last();
    expect(retry).not.toBe(first);
    expect(retry.cacheOnly).toBe(false);
    expect(retry.request).toEqual(first.request);
    expect(card().textContent).toContain("판정 중");
    retry.reply({ ok: true, result: RESULT });
    await settle();
    expect(card().textContent).toContain("1.5");
  });

  it("다시 보내도 계속 끊기면 오류를 보여 준다", async () => {
    await goTo("#/shorts/dead?step=2");
    last().reply(NOT_CACHED);
    card().querySelector<HTMLButtonElement>(".sj-run")!.click();
    await settle();
    for (let i = 0; i < 4; i++) {
      last().drop();
      await settle();
    }
    expect(card().textContent).toContain("판정 서버와 연결이 끊겼어요");
    expect(card().textContent).toContain("다시 시도");
  });

  it("다른 쇼츠로 옮겨 가면 앞 쇼츠의 결과를 보여 주지 않는다", async () => {
    await goTo("#/shorts/b?step=2");
    expect(last().cacheOnly).toBe(true); // b에서 저장된 결과를 다시 묻는다
    expect(card().textContent).toContain("판정하기");
    expect(card().textContent).not.toContain("대본이 바뀌었어요");
    expect(document.querySelector("[data-sj='chips']")).toBeNull();
  });

  it("판정 중에 다른 쇼츠로 옮겨 가면 늦게 온 답은 버린다", async () => {
    last().reply(NOT_CACHED);
    card().querySelector<HTMLButtonElement>(".sj-run")!.click();
    await settle();
    const pending = last();
    expect(pending.cacheOnly).toBe(false);

    await goTo("#/shorts/c?step=2");
    pending.reply({ ok: true, result: RESULT });
    await settle();
    expect(card().textContent).toContain("판정하기");
    expect(card().textContent).not.toContain("1.5");
  });

  it("판정 중에 섹션 하나를 비워도 카드는 멈추지 않고, 답이 오면 바뀐 대본이라는 표시와 함께 보여 준다", async () => {
    await goTo("#/shorts/empty?step=2");
    last().reply(NOT_CACHED);
    card().querySelector<HTMLButtonElement>(".sj-run")!.click();
    await settle();
    const pending = last();

    const second = document.querySelectorAll("textarea")[1]!;
    second.value = "";
    second.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(card().textContent).toContain("판정 중");

    pending.reply({ ok: true, result: RESULT });
    await settle();
    expect(card().textContent).toContain("1.5");
    expect(card().textContent).toContain("대본이 바뀌었어요");
    expect(document.querySelector("[data-sj='chips']")).toBeNull();
    // 빈 섹션이 있으면 판정할 수 없으므로 버튼을 막는다
    expect(card().querySelector<HTMLButtonElement>(".sj-run")!.disabled).toBe(true);

    second.value = SECTIONS[1]!.text;
    second.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    expect(card().textContent).not.toContain("대본이 바뀌었어요");
    expect(card().querySelector<HTMLButtonElement>(".sj-run")!.disabled).toBe(false);
  });
});
