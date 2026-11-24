import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * 백그라운드(서비스 워커). chrome.runtime과 fetch를 가짜로 바꿔 끼운다.
 */
type Listener = (message: { request: unknown; cacheOnly: boolean }) => Promise<void>;

let onConnect: (port: unknown) => void;
vi.stubGlobal("chrome", { runtime: { onConnect: { addListener: (fn: (port: unknown) => void) => (onConnect = fn) } } });

function openPort() {
  const posted: unknown[] = [];
  let listener: Listener | undefined;
  let closed = false;
  const port = {
    name: "judge",
    onMessage: { addListener: (fn: Listener) => (listener = fn) },
    postMessage: (message: unknown) => {
      if (closed) throw new Error("Attempting to use a disconnected port object");
      posted.push(message);
    },
  };
  onConnect(port);
  return { posted, send: (cacheOnly: boolean) => listener!({ request: { title: "t" }, cacheOnly }), close: () => (closed = true) };
}

let KEEP_ALIVE_MS: number;
beforeAll(async () => {
  ({ KEEP_ALIVE_MS } = await import("../src/background"));
});
afterEach(() => vi.useRealTimers());

function pendingFetch() {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => (resolve = r))));
  return (status: number, body: unknown) => resolve(new Response(JSON.stringify(body), { status }));
}

describe("백그라운드", () => {
  it("판정을 기다리는 동안 신호를 보내 깨어 있고, 답이 오면 신호를 멈춘다", async () => {
    vi.useFakeTimers();
    const answer = pendingFetch();
    const { posted, send } = openPort();
    const done = send(false);

    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS * 2);
    expect(posted).toEqual([{ wait: true }, { wait: true }]);

    answer(200, { key: "k" });
    await done;
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS * 2);
    expect(posted).toEqual([{ wait: true }, { wait: true }, { ok: true, result: { key: "k" } }]);
  });

  it("서버 오류는 메시지로 돌려준다", async () => {
    const answer = pendingFetch();
    const { posted, send } = openPort();
    const done = send(true);
    answer(404, { error: "아직 판정한 적 없는 대본이에요." });
    await done;
    expect(posted).toEqual([{ ok: false, status: 404, message: "아직 판정한 적 없는 대본이에요." }]);
  });

  it("페이지가 먼저 떠나 포트가 닫혀도 예외 없이 끝난다", async () => {
    vi.useFakeTimers();
    const answer = pendingFetch();
    const { send, close } = openPort();
    const done = send(false);
    close();
    await vi.advanceTimersByTimeAsync(KEEP_ALIVE_MS);
    answer(200, { key: "k" });
    await expect(done).resolves.toBeUndefined();
  });
});
