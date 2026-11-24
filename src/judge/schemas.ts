import { z } from "zod";

/**
 * LLM 응답 형식. 필드 순서는 '근거 → 이유 → 단계'다.
 * 1~5 범위 같은 제약은 API 스키마에서 빠질 수 있어서, 받은 뒤 이 스키마로 다시 검사한다.
 */
const Level = z.number().int().min(1).max(5);
const Quote = z.string().describe("대본에서 글자 그대로 옮긴 구절");
const SectionNo = z.number().int().describe("섹션 번호");

export const OpeningAnswer = z.object({
  elements: z
    .array(
      z.object({
        quote: Quote,
        type: z.enum(["질문", "갈등", "의외의 사실", "숫자", "이익·손해"]),
      }),
    )
    .describe("제목이나 첫 3초 안에서 궁금증을 만드는 구절. 없으면 빈 배열"),
  reason: z.string(),
  level: Level,
});

export const FlowAnswer = z.object({
  sections: z.array(
    z.object({
      order: SectionNo,
      quote: Quote.describe("이 섹션이 새로 더하는 정보를 대표하는 구절"),
      reason: z.string(),
      level: Level,
    }),
  ),
  transitions: z.array(
    z.object({
      from: SectionNo,
      to: SectionNo,
      quote: Quote.describe("연결을 보여 주는 구절. 앞 섹션의 끝이나 뒤 섹션의 처음에서"),
      reason: z.string(),
      level: Level,
    }),
  ),
});

export const SENSITIVE_TOPICS = ["정치", "젠더", "세대", "종교", "기득권", "유명인"] as const;

export const EngagementAnswer = z.object({
  sensitive_topics: z.array(
    z.object({
      section: SectionNo,
      quote: Quote,
      topic: z.enum(SENSITIVE_TOPICS),
      is_central: z.boolean().describe("이 주제가 대본의 중심 내용인가. 스치듯 언급하거나 배경으로만 나오면 false"),
      reason: z.string(),
    }),
  ),
  issues: z.array(
    z.object({
      section: SectionNo,
      quote: Quote,
      question: z.string().describe("시청자가 편을 나눌 수 있는 찬반 질문. 대본이 말한 범위 안에서"),
      raised_by_script: z
        .boolean()
        .describe("대본에 서로 다른 입장이 함께 나오거나 판단·선택을 묻는 물음이 있으면 true. 한쪽 주장만 있거나 평가자가 떠올린 쟁점이면 false"),
      is_opinion_split: z.boolean().describe("사실을 찾아보면 끝나는 문제가 아니라 생각이 갈리는 문제인가"),
      can_state_position: z.boolean().describe("시청자가 자기 입장을 한 문장으로 말할 수 있는가"),
      shows_both_sides: z.boolean().describe("대본이 양쪽 입장을 다 보여 주는가"),
    }),
  ),
  emotions: z.array(
    z.object({
      section: SectionNo,
      quote: Quote,
      emotion: z.enum(["분노·억울함", "놀람", "공감·연민", "불안", "웃음"]),
      strength: z.enum(["약", "강"]),
    }),
  ),
  harm_structure: z.object({
    present: z.boolean().describe("누가 누구에게 피해를 주는 구도가 있는가"),
    section: SectionNo.nullable(),
    quote: Quote.nullable(),
  }),
  twist: z.object({
    present: z.boolean().describe("예상을 뒤집는 반전이 있는가"),
    section: SectionNo.nullable(),
    quote: Quote.nullable(),
  }),
  policy_risk: z.object({
    present: z.boolean().describe("혐오, 특정 집단 비하, 폭력 조장으로 넘어가는가"),
    reason: z.string().nullable(),
  }),
});

export const AffinityAnswer = z.object({
  useful_info: z.array(
    z.object({
      section: SectionNo,
      quote: Quote,
      action: z.string().describe("시청자가 이 정보로 할 수 있는 일"),
      for_most: z.boolean().describe("대부분의 시청자에게 쓸모 있는가. 특정 직업이나 상황에만 해당하면 false"),
      is_common_knowledge: z.boolean().describe("대부분 이미 아는 상식인가"),
      is_specific: z.boolean().describe("그대로 따라 할 만큼 구체적인가(언제, 얼마나, 어떻게)"),
    }),
  ),
  promise: z.object({
    text: z.string().describe("제목과 첫 3초가 시청자에게 기대하게 한 것을 한 문장으로"),
    source_quote: Quote.describe("약속이 드러난 구절. 제목이나 첫 3초에서"),
    fulfilled_section: SectionNo.nullable(),
    fulfilled_quote: Quote.nullable(),
    degree: z.enum(["채우지 않음", "관련 이야기만", "일부", "완전", "초과"]),
  }),
});

/** 감사는 '의심'인 항목만 적는다. 적지 않은 항목은 타당으로 본다(프롬프트 2026-11-12.1, 응답 시간을 줄이려고) */
export const AuditAnswer = z.object({
  items: z
    .array(
      z.object({
        id: z.string().describe("정리본에 적힌 항목 ID"),
        reason: z.string().describe("무엇이 왜 의심스러운지 한 문장"),
        suggested_level: Level.nullable().describe("단계가 있는 항목이면 맞다고 보는 단계. 그 밖에는 null"),
      }),
    )
    .describe("'의심'인 항목만. 모두 타당하면 빈 배열"),
  overall: z.string().describe("판정 전체에서 보이는 치우침이나 일관성 문제 한 문장. 없으면 '없음'"),
});

export type OpeningAnswer = z.infer<typeof OpeningAnswer>;
export type FlowAnswer = z.infer<typeof FlowAnswer>;
export type EngagementAnswer = z.infer<typeof EngagementAnswer>;
export type AffinityAnswer = z.infer<typeof AffinityAnswer>;
export type AuditAnswer = z.infer<typeof AuditAnswer>;
