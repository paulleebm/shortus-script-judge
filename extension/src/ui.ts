import type { JudgeItemView, JudgeResponse } from "../../src/api";
import { SELECTORS } from "./dom";

/**
 * 쇼더스 화면에 판정 결과를 그린다.
 * - 쇼더스의 디자인 토큰(--card, --accent, --radius …)과 기존 클래스(card, label-caps)를 그대로 써서 원래 기능처럼 보이게 한다
 * - 우리가 넣은 요소에는 data-sj를 붙여 구분한다
 * - 판정 결과(AI가 만든 글)는 textContent로만 넣는다(innerHTML 금지)
 */
export type ViewState =
  | { phase: "idle" }
  | { phase: "loading"; startedAt: number }
  | { phase: "result"; result: JudgeResponse; stale: boolean }
  | { phase: "error"; message: string };

const STYLE_ID = "sj-style";
const LOW = 2;

export const STYLES = `
.sj-card{display:flex;flex-direction:column;gap:12px;padding:20px 24px}
.sj-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.sj-meta{font-size:var(--fs-micro);color:var(--ink-400);font-variant-numeric:tabular-nums}
.sj-groups{display:flex;flex-direction:column;gap:10px}
.sj-group{display:grid;grid-template-columns:44px 1fr auto;align-items:center;gap:10px;font-size:var(--fs-body)}
.sj-group b{font-weight:var(--fw-bold);font-variant-numeric:tabular-nums}
.sj-meter{display:flex;gap:3px}
.sj-meter i{flex:1;height:6px;border-radius:999px;background:var(--fill-muted)}
.sj-meter i.on{background:var(--ink)}
.sj-meter.low i.on{background:var(--accent)}
.sj-sub{font-size:var(--fs-hint);color:var(--ink-500);font-weight:var(--fw-semi)}
.sj-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}
.sj-list li{display:flex;gap:8px;align-items:flex-start;font-size:var(--fs-hint);color:var(--ink-600);line-height:var(--lh-snug)}
.sj-sec{flex:none;border:0;border-radius:999px;padding:2px 9px;background:var(--status-warn-bg);color:var(--status-warn-text);font:var(--fw-medium) var(--fs-hint) var(--font-sans);cursor:pointer}
.sj-sec:focus-visible,.sj-run:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sj-run{align-self:flex-start;border:1px solid var(--line);background:var(--card);border-radius:var(--radius-control);padding:9px 14px;font:var(--fw-semi) var(--fs-body) var(--font-sans);color:var(--ink);cursor:pointer}
.sj-run:disabled{color:var(--ink-400);cursor:default}
.sj-note{font-size:var(--fs-hint);color:var(--ink-500);line-height:var(--lh-snug)}
.sj-note.warn{color:var(--status-warn-text)}
.sj-note.fail{color:var(--status-fail-ink)}
.sj-chips{display:flex;gap:6px;flex-wrap:wrap}
.sj-chip{border-radius:999px;padding:2px 9px;font-size:var(--fs-hint);font-weight:var(--fw-medium);background:var(--status-neutral-bg);color:var(--status-neutral-text)}
.sj-chip.warn{background:var(--status-warn-bg);color:var(--status-warn-text)}
.sj-flash{outline:2px solid var(--accent);outline-offset:2px;transition:outline-color .4s}
@media (prefers-reduced-motion: reduce){.sj-flash{transition:none}}
`;

export function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  doc.head.appendChild(style);
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function meter(doc: Document, value: number | null): HTMLElement {
  const box = el(doc, "div", `sj-meter${value !== null && value <= LOW ? " low" : ""}`);
  for (let i = 1; i <= 5; i++) box.appendChild(el(doc, "i", value !== null && i <= Math.round(value) ? "on" : ""));
  return box;
}

const GROUPS: [keyof JudgeResponse["groups"], string][] = [
  ["watch", "시청"],
  ["engage", "활동"],
  ["affinity", "호감"],
];

export interface SideCardHandlers {
  /** 지금 대본을 판정할 수 있는가(빈 섹션이 있으면 false) */
  canRun: boolean;
  onRun: () => void;
  onSection: (section: number) => void;
}

/** 오른쪽 열 '확정 준비' 카드 아래에 판정 카드를 그린다. 상태가 같으면 다시 그리지 않는다 */
export function renderSideCard(doc: Document, state: ViewState, handlers: SideCardHandlers): void {
  const checklist = doc.querySelector(SELECTORS.checklist);
  if (!checklist) return;
  let card = doc.querySelector<HTMLElement>("[data-sj='card']");
  if (!card || card.previousElementSibling !== checklist) {
    card?.remove();
    card = el(doc, "div", "card sj-card");
    card.dataset.sj = "card";
    checklist.after(card);
  }
  const signature = `${signatureOf(state)}:${handlers.canRun}`;
  if (card.dataset.sig === signature) return;
  card.dataset.sig = signature;
  card.replaceChildren(...sideCardContent(doc, state, handlers));
}

function signatureOf(state: ViewState): string {
  switch (state.phase) {
    case "idle":
      return "idle";
    case "loading":
      return `loading:${Math.floor((Date.now() - state.startedAt) / 1000)}`;
    case "result":
      return `result:${state.result.key}:${state.stale}`;
    case "error":
      return `error:${state.message}`;
  }
}

function sideCardContent(doc: Document, state: ViewState, handlers: SideCardHandlers): HTMLElement[] {
  const head = el(doc, "div", "sj-head");
  head.appendChild(el(doc, "span", "label-caps", "대본 판정"));
  const nodes: HTMLElement[] = [head];
  const run = el(doc, "button", "sj-run");
  run.type = "button";
  run.addEventListener("click", handlers.onRun);

  if (state.phase === "idle") {
    run.textContent = "판정하기";
  } else if (state.phase === "loading") {
    run.textContent = `판정 중 · ${Math.floor((Date.now() - state.startedAt) / 1000)}초`;
    run.disabled = true;
  } else if (state.phase === "error") {
    nodes.push(el(doc, "p", "sj-note fail", state.message));
    run.textContent = "다시 시도";
  } else {
    const { result } = state;
    head.appendChild(el(doc, "span", "sj-meta", `${(result.elapsedMs / 1000).toFixed(0)}초 · $${result.costUsd.toFixed(2)}`));
    const groups = el(doc, "div", "sj-groups");
    for (const [key, name] of GROUPS) {
      const value = result.groups[key];
      const row = el(doc, "div", "sj-group");
      row.append(el(doc, "span", "", name), meter(doc, value), el(doc, "b", "", value === null ? "–" : value.toFixed(1)));
      groups.appendChild(row);
    }
    nodes.push(groups);
    if (result.regenerate.length > 0) {
      nodes.push(el(doc, "div", "sj-sub", "다시 만들 섹션"));
      const list = el(doc, "ul", "sj-list");
      for (const item of result.regenerate) {
        const li = el(doc, "li");
        const button = el(doc, "button", "sj-sec", `섹션 ${item.section}`);
        button.type = "button";
        button.addEventListener("click", () => handlers.onSection(item.section));
        li.append(button, el(doc, "span", "", item.reasons.join(" · ")));
        list.appendChild(li);
      }
      nodes.push(list);
    }
    if (result.policyRisk?.present) nodes.push(el(doc, "p", "sj-note fail", `정책 위험: ${result.policyRisk.reason ?? ""}`));
    if (state.stale) nodes.push(el(doc, "p", "sj-note warn", "대본이 바뀌었어요"));
    run.textContent = "다시 판정";
  }
  if (!handlers.canRun) run.disabled = true;
  nodes.push(run);
  return nodes;
}

/** 섹션마다 '정보 흥미', '앞과의 흐름' 단계를 칩으로 붙인다. result가 null이면 지운다 */
export function renderInlineChips(doc: Document, result: JudgeResponse | null): void {
  const cards = [...doc.querySelectorAll<HTMLElement>(SELECTORS.section)];
  cards.forEach((card, index) => {
    const bar = card.querySelector<HTMLElement>(SELECTORS.sectionBar);
    const existing = card.querySelector<HTMLElement>("[data-sj='chips']");
    if (!result || !bar) {
      existing?.remove();
      return;
    }
    const order = index + 1;
    const signature = `${result.key}:${order}`;
    if (existing?.dataset.sig === signature) return;
    existing?.remove();
    const chips = el(doc, "div", "sj-chips");
    chips.dataset.sj = "chips";
    chips.dataset.sig = signature;
    addChip(doc, chips, "정보 흥미", find(result.items, `시청2-${order}`));
    if (order > 1) addChip(doc, chips, "앞과의 흐름", find(result.items, `시청3-${order - 1}→${order}`));
    bar.prepend(chips);
  });
}

function find(items: JudgeItemView[], id: string): JudgeItemView | undefined {
  return items.find((item) => item.id === id);
}

function addChip(doc: Document, box: HTMLElement, label: string, item: JudgeItemView | undefined): void {
  if (!item || item.level === null || item.status !== "ok") return;
  const chip = el(doc, "span", `sj-chip${item.level <= LOW ? " warn" : ""}`, `${label} ${item.level}`);
  chip.title = item.reason;
  box.appendChild(chip);
}

/** 섹션 카드로 스크롤하고 잠깐 테두리를 표시한다 */
export function highlightSection(doc: Document, section: number): void {
  const card = doc.querySelectorAll<HTMLElement>(SELECTORS.section)[section - 1];
  if (!card) return;
  card.scrollIntoView({ block: "center", behavior: "smooth" });
  card.classList.add("sj-flash");
  setTimeout(() => card.classList.remove("sj-flash"), 1600);
}
