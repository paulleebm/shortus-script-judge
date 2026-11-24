import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { FLOW_SAMPLES } from "../src/judge/index.js";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { JudgeRequest } from "../src/api.js";
import { judgeScript } from "../src/judge/index.js";
import { recordFixtures } from "../src/report.js";
import { ScriptSchema } from "../src/script.js";
import { contentKey, createJudgeServer } from "../src/server.js";
import { FAKE_ANSWERS, fakeCaller } from "./helpers/fake-judge.js";

/**
 * 로컬 판정 서버 시험. LLM은 가짜 호출기로 바꿔 끼운다(실제 요청 없음).
 */
const s00 = JSON.parse(readFileSync("data/scripts/S00.json", "utf8")) as JudgeRequest & { id: string };
const request: JudgeRequest = { title: s00.title, sections: s00.sections };
const EXT_ORIGIN = "chrome-extension://abcdefghijklmnop";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function start(options: Parameters<typeof createJudgeServer>[0]) {
  const dir = mkdtempSync(join(tmpdir(), "judge-server-"));
  const server = createJudgeServer({ cacheDir: join(dir, "cache"), runsDir: join(dir, "runs"), ...options });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  close = () => new Promise((resolve) => server.close(() => resolve()));
  const { port } = server.address() as AddressInfo;
  return (path: string, init: RequestInit = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      ...init,
      headers: { "content-type": "application/json", origin: EXT_ORIGIN, ...(init.headers ?? {}) },
    });
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

describe("로컬 판정 서버", () => {
  it("확장 프로그램이 아닌 곳에서 온 요청은 막는다", async () => {
    const { caller } = fakeCaller(FAKE_ANSWERS);
    const call = await start({ caller });
    expect((await call("/health", { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await call("/health")).status).toBe(200);
  });

  it("형식이 틀린 대본은 400으로 돌려보낸다", async () => {
    const { caller } = fakeCaller(FAKE_ANSWERS);
    const call = await start({ caller });
    expect((await call("/judge", post({ title: "제목", sections: [] }))).status).toBe(400);
    expect((await call("/judge", { method: "POST", body: "{" })).status).toBe(400);
  });

  it("처음엔 저장된 결과가 없고, 판정한 뒤에는 같은 대본을 다시 부르지 않는다", async () => {
    const { caller, started } = fakeCaller(FAKE_ANSWERS);
    const call = await start({ caller });

    expect((await call("/judge?cacheOnly=1", post(request))).status).toBe(404);
    const first = await (await call("/judge", post(request))).json();
    expect(first.cached).toBe(false);
    expect(first.key).toBe(contentKey(request));
    expect(first.groups.engage).toBe(4);
    expect(first.regenerate).toEqual([{ section: 2, reasons: ["앞 섹션과 자연스럽게 이어지지 않아요"] }]);

    const again = await (await call("/judge?cacheOnly=1", post(request))).json();
    expect(again.cached).toBe(true);
    expect(started).toHaveLength(4 + FLOW_SAMPLES); // 판정은 한 번만
  });

  it("데모 모드는 저장 대본과 내용이 같으면 저장된 응답으로, 다르면 404", async () => {
    // S00을 가짜 호출기로 판정해 임시 폴더에 응답 기록을 남기고, 그 기록으로 데모 모드를 띄운다
    const fixturesRoot = mkdtempSync(join(tmpdir(), "judge-fixtures-"));
    const live = await judgeScript(ScriptSchema.parse(s00), fakeCaller(FAKE_ANSWERS).caller);
    await recordFixtures(live, fixturesRoot);

    const call = await start({ replay: true, fixturesRoot });
    const ok = await call("/judge", post(request));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.groups).toEqual({ watch: live.scored.watch.score, engage: live.scored.engage.score, affinity: live.scored.affinity.score });

    const changed = { ...request, title: "다른 제목" };
    expect((await call("/judge", post(changed))).status).toBe(404);
  });

  it("데모 모드에서 저장 대본이어도 응답 기록이 없으면(시험용처럼) 404로 알린다", async () => {
    const empty = mkdtempSync(join(tmpdir(), "judge-fixtures-"));
    const call = await start({ replay: true, fixturesRoot: empty });
    const res = await call("/judge", post(request));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("저장된 판정이 없어요. 데모 모드는 미리 판정해 둔 대본만 보여 줘요.");
  });
});

describe("공개 서버 막이", () => {
  const other: JudgeRequest = { ...request, title: `${request.title} (다른 대본)` };

  it("받을 확장 ID를 정하면 그 확장에서 온 요청만 받는다", async () => {
    const { caller } = fakeCaller(FAKE_ANSWERS);
    const call = await start({ caller, extensionIds: ["abcdefghijklmnop"] });
    expect((await call("/health")).status).toBe(200);
    expect((await call("/health", { headers: { origin: "chrome-extension://zzzzzzzzzzzzzzzz" } })).status).toBe(403);
  });

  it("IP마다 시간당 새 판정 수를 넘으면 429, 이미 판정한 대본은 계속 돌려준다", async () => {
    const { caller } = fakeCaller(FAKE_ANSWERS);
    const call = await start({ caller, ratePerHour: 1 });
    expect((await call("/judge", post(request))).status).toBe(200);
    const blocked = await call("/judge", post(other));
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toContain("한 시간");
    expect((await call("/judge", post(request))).status).toBe(200);
  });

  it("오늘 쓴 요금이 하루 상한에 닿으면 새 판정을 막고, 날이 바뀌면 다시 받는다", async () => {
    const { caller } = fakeCaller(FAKE_ANSWERS);
    const runsDir = mkdtempSync(join(tmpdir(), "judge-spend-"));
    let time = Date.parse("2026-11-20T03:00:00Z"); // 한국 시간 11월 20일 12시
    writeFileSync(join(runsDir, "server-spend.json"), JSON.stringify({ day: "2026-11-20", usd: 4.9 }));
    const call = await start({ caller, runsDir, dailyBudgetUsd: 5, now: () => time });
    const blocked = await call("/judge", post(request));
    expect(blocked.status).toBe(429);
    expect(((await blocked.json()) as { error: string }).error).toContain("오늘 판정 한도");
    time = Date.parse("2026-11-20T16:00:00Z"); // 한국 시간 11월 21일 1시
    expect((await call("/judge", post(request))).status).toBe(200);
    const spend = JSON.parse(readFileSync(join(runsDir, "server-spend.json"), "utf8")) as { day: string };
    expect(spend.day).toBe("2026-11-21");
  });
});
