/**
 * 확장의 백그라운드(서비스 워커). 페이지(https)는 판정 서버를 직접 부를 수 없어서 여기서 대신 부른다.
 * 판정은 수십 초 걸릴 수 있어서 일회성 메시지 대신 포트를 열어 두고 답을 돌려준다.
 * 서버 주소는 빌드할 때 넣는다(JUDGE_SERVER_URL). 없으면 이 PC의 로컬 판정 서버.
 */
declare const __JUDGE_SERVER__: string | undefined;
const SERVER = typeof __JUDGE_SERVER__ === "string" ? __JUDGE_SERVER__ : "http://127.0.0.1:8787";
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(SERVER);
const UNREACHABLE = LOCAL
  ? "판정 서버에 연결하지 못했어요. 터미널에서 npm run serve를 실행해 주세요."
  : "판정 서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.";
// 서비스 워커는 30초 동안 확장 API를 쓰지 않으면 브라우저가 멈춘다. 기다리는 동안 이 간격으로 신호를 보내 깨워 둔다
export const KEEP_ALIVE_MS = 20_000;

/** 페이지가 먼저 떠나 포트가 닫혔으면 보내지 않는다(닫힌 포트에 보내면 예외가 난다) */
function post(port: chrome.runtime.Port, message: unknown): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "judge") return;
  port.onMessage.addListener(async (message: { request: unknown; cacheOnly: boolean }) => {
    const keepAlive = setInterval(() => {
      if (!post(port, { wait: true })) clearInterval(keepAlive);
    }, KEEP_ALIVE_MS);
    try {
      const response = await fetch(`${SERVER}/judge${message.cacheOnly ? "?cacheOnly=1" : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message.request),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        post(port, { ok: true, result: body });
      } else {
        const error = (body as { error?: string } | null)?.error ?? `판정 서버 오류(${response.status})`;
        post(port, { ok: false, status: response.status, message: error });
      }
    } catch {
      post(port, { ok: false, status: 0, message: UNREACHABLE });
    } finally {
      clearInterval(keepAlive);
    }
  });
});
