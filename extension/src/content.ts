import type { JudgeRequest, JudgeResponse } from "../../src/api";
import { fingerprint, isScriptStep, readScript } from "./dom";
import { ensureStyles, highlightSection, renderInlineChips, renderSideCard, type ViewState } from "./ui";

/**
 * 쇼더스 Studio 페이지에 붙는 스크립트.
 * 2단계 화면이 보이면 판정 카드를 넣고, 판정 요청은 백그라운드(→ 로컬 판정 서버)로 보낸다.
 * 화면은 SPA라 섹션을 고치거나 단계를 옮기면 DOM이 다시 그려지므로, 변화를 지켜보다가 우리 요소를 다시 붙인다.
 */

// 배치: 오른쪽 '확정 준비' 아래 판정 카드 + 섹션마다 점수 칩(시안 C, 2026-11-12 사용자 확정)

type Reply = { ok: true; result: JudgeResponse } | { ok: false; status: number; message: string } | { wait: true };

// 백그라운드가 도중에 멈춰 포트가 끊기면 같은 요청을 다시 보낸다. 서버는 같은 대본을 한 번만 판정하고(진행 중이면 그 결과를 기다림)
// 결과를 저장하므로 다시 보내도 요금이 두 번 들지 않는다
const MAX_RETRIES = 3;

let state: ViewState = { phase: "idle" };
let project = currentProject();
let currentPrint: string | null = null;
let judgedPrint: string | null = null;
const checkedPrints = new Set<string>();
let timer: number | undefined;

/** 주소의 해시 경로(#/shorts/<id>)가 곧 지금 보고 있는 쇼츠다. */
function currentProject(): string {
  return location.hash.split("?")[0] ?? "";
}

function request(script: JudgeRequest, cacheOnly: boolean, attempt = 0): void {
  const print = fingerprint(script);
  const from = project;
  if (!cacheOnly && attempt === 0) setState({ phase: "loading", startedAt: Date.now() });
  const port = chrome.runtime.connect({ name: "judge" });
  let answered = false;
  port.onMessage.addListener((reply: Reply) => {
    if ("wait" in reply) return; // 백그라운드가 아직 기다리는 중이라는 신호
    answered = true;
    port.disconnect();
    if (from !== project) return; // 그사이 다른 쇼츠로 옮겨 갔으면 버린다(결과는 서버에 남는다)
    if (reply.ok) {
      judgedPrint = print;
      setState({ phase: "result", result: reply.result, stale: false });
    } else if (!cacheOnly) {
      setState({ phase: "error", message: reply.message });
    }
  });
  port.onDisconnect.addListener(() => {
    if (answered || from !== project) return;
    if (attempt < MAX_RETRIES) request(script, cacheOnly, attempt + 1);
    else if (!cacheOnly) setState({ phase: "error", message: "판정 서버와 연결이 끊겼어요. 다시 시도해 주세요." });
  });
  port.postMessage({ request: script, cacheOnly });
}

function setState(next: ViewState): void {
  state = next;
  if (timer !== undefined) clearInterval(timer);
  timer = next.phase === "loading" ? window.setInterval(render, 1000) : undefined;
  render();
}

function render(): void {
  const here = currentProject();
  if (here !== project) {
    // 다른 쇼츠로 옮겨 가면 앞 쇼츠의 결과를 들고 가지 않는다
    project = here;
    state = { phase: "idle" };
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    currentPrint = null;
    judgedPrint = null;
    checkedPrints.clear();
  }

  if (!isScriptStep(document)) return;
  ensureStyles(document);

  // 빈 섹션이 있으면 대본을 읽지 못한다(null). 그래도 카드는 계속 그린다. 판정 중 시간과 늦게 온 결과가 멈추지 않게
  const script = readScript(document);
  const print = script ? fingerprint(script) : null;
  if (print !== currentPrint) {
    currentPrint = print;
    // 처음 보는 대본이면 저장된 결과만 조용히 물어본다(요금 없음)
    if (script && print && !checkedPrints.has(print) && state.phase !== "loading") {
      checkedPrints.add(print);
      request(script, true);
    }
  }

  const view: ViewState = state.phase === "result" ? { ...state, stale: judgedPrint !== print } : state;
  const fresh = view.phase === "result" && !view.stale ? view.result : null;

  renderSideCard(document, view, {
    canRun: script !== null,
    onRun: () => {
      const latest = readScript(document);
      if (latest) request(latest, false);
    },
    onSection: (section) => highlightSection(document, section),
  });
  renderInlineChips(document, fresh);
}

let scheduled = false;
const observer = new MutationObserver((mutations) => {
  // 우리 요소만 바뀐 경우는 무시한다
  const external = mutations.some((m) => !(m.target instanceof HTMLElement && m.target.closest("[data-sj]")));
  if (!external || scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    render();
  });
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true });
document.addEventListener("input", () => requestAnimationFrame(render), true);
render();
