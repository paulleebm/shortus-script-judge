import { requestHash, type CallRecord, type CallSpec, type LlmCaller } from "../../src/judge/llm.js";

/** 판정 흐름 시험용 가짜 LLM 응답(S00 기준). 손으로 만든 것이라 실제 모델 응답이 아니다. */
export const FAKE_ANSWERS: Record<string, unknown> = {
  "watch1-opening": {
    elements: [
      { quote: "스파이 의혹", type: "갈등" },
      { quote: "충격적인 반전", type: "의외의 사실" }, // 대본에 없는 인용: 버려져야 한다
    ],
    reason: "의혹이라는 갈등 요소가 3초 끝에 걸린다",
    level: 4,
  },
  "watch2-3-flow": {
    sections: [
      { order: 1, quote: "외도를 인정하면서", reason: "사건 제시", level: 4 },
      { order: 2, quote: "해임이 어렵다는 의견과", reason: "의견 대립만 나열", level: 2 },
      { order: 3, quote: "지분도 3.58퍼센트뿐이라", reason: "구체적 숫자", level: 4 },
      { order: 4, quote: "50 대 50으로 전망하며", reason: "전망 제시", level: 3 },
    ],
    transitions: [
      { from: 1, to: 2, quote: "그는 수많은 직보 임원과", reason: "조사에서 해임 논쟁으로 갑자기 넘어감", level: 2 },
      { from: 2, to: 3, quote: "황은 다른 빅테크 창업자와 달리", reason: "근거로 이어짐", level: 3 },
      { from: 3, to: 4, quote: "예일대 교수는", reason: "전문가 전망으로 마무리", level: 3 },
    ],
  },
  "engage-activity": {
    sensitive_topics: [
      { section: 1, quote: "엔비디아 CEO 젠슨 황", topic: "유명인", is_central: true, reason: "유명 기업인" },
      { section: 3, quote: "이사회가 해임을 결정하면", topic: "기득권", is_central: false, reason: "지배구조를 스치듯 언급" }, // 붙이지 않아야 한다
    ],
    issues: [
      {
        section: 2,
        quote: "잘릴 수 있다는 주장이 팽팽합니다",
        question: "젠슨 황은 자리를 지킬 수 있을까?",
        raised_by_script: true,
        is_opinion_split: true,
        can_state_position: true,
        shows_both_sides: true,
      },
      {
        section: 1,
        quote: "외도를 인정하면서",
        question: "사생활이 해임 사유가 되어야 할까?",
        raised_by_script: false, // 평가자가 떠올린 쟁점: 세면 5가 된다
        is_opinion_split: true,
        can_state_position: true,
        shows_both_sides: false,
      },
    ],
    emotions: [
      { section: 1, quote: "스파이 의혹 여성과의 외도를 인정하면서", emotion: "놀람", strength: "강" },
      { section: 3, quote: "막을 방법이 거의 없습니다", emotion: "불안", strength: "약" },
    ],
    harm_structure: { present: false, section: null, quote: null },
    twist: { present: false, section: null, quote: null },
    policy_risk: { present: false, reason: null },
  },
  affinity: {
    useful_info: [],
    promise: {
      text: "젠슨 황이 해임될 수 있는지 알려 준다",
      source_quote: "젠슨 황, 잘릴 수 있을까?",
      fulfilled_section: 4,
      fulfilled_quote: "50 대 50으로 전망하며",
      degree: "완전",
    },
  },
  "audit-fairness": {
    // 감사는 '의심'인 항목만 적는다(프롬프트 2026-11-12.1)
    items: [{ id: "시청2-2", reason: "의견 대립 자체가 새 정보라 2단계는 박하다", suggested_level: 4 }],
    overall: "대체로 기준표와 맞다",
  },
};

export function fakeCaller(answers: Record<string, unknown>) {
  const started: string[] = [];
  let pending = 0;
  let release: () => void = () => {};
  const allFourStarted = new Promise<void>((resolve) => (release = resolve));

  const caller: LlmCaller = {
    model: "fake",
    effort: "medium",
    speed: "standard",
    async call<T>(spec: CallSpec<T>) {
      started.push(spec.name);
      if (spec.name !== "audit-fairness") {
        pending += 1;
        if (pending === 4) release();
        await allFourStarted; // 차례대로 부르면 여기서 멈춰 시험이 시간 초과로 실패한다
      }
      const raw = answers[spec.name.replace(/#d+$/, "")]; // 같은 질문을 여러 번 물으면 같은 가짜 답
      const output = raw === undefined ? null : spec.schema.parse(raw);
      const record: CallRecord = {
        name: spec.name,
        model: "fake",
        effort: "medium",
        speed: "standard",
        request_hash: requestHash("fake", "medium", spec.system, spec.user),
        request: { system: spec.system, user: spec.user },
        raw_text: JSON.stringify(raw ?? null),
        output,
        stop_reason: "end_turn",
        usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0 },
        attempts: 1,
        latency_ms: 1,
        error: null,
      };
      return { output, record };
    },
  };
  return { caller, started };
}
