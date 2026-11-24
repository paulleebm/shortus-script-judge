import { z } from "zod";

/**
 * 크롬 확장 ↔ 로컬 판정 서버 사이의 약속.
 * 확장은 이 파일에서 타입만 가져간다(번들에 zod가 들어가지 않는다).
 */
export const JudgeRequestSchema = z.object({
  title: z.string().trim().min(1).max(300),
  sections: z
    .array(
      z.object({
        order: z.number().int().positive(),
        role: z.string().trim().min(1).max(30),
        narration: z.string().trim().min(1).max(1000),
        seconds: z.number().positive().max(120),
      }),
    )
    .min(2)
    .max(20),
});

export type JudgeRequest = z.infer<typeof JudgeRequestSchema>;

export interface JudgeItemView {
  id: string;
  label: string;
  kind: "level" | "tag";
  level: number | null;
  status: "ok" | "uncertain";
  section: number | null;
  reason: string;
  evidence: string[];
  audit?: { verdict: "타당" | "의심"; reason: string | null; suggested_level: number | null };
}

export interface JudgeResponse {
  key: string;
  cached: boolean;
  promptVersion: string;
  model: string;
  groups: { watch: number | null; engage: number | null; affinity: number | null };
  items: JudgeItemView[];
  regenerate: { section: number; reasons: string[] }[];
  policyRisk: { present: boolean; reason: string | null } | null;
  audit: { checked: number; suspicious: number; overall: string | null };
  opening: { text: string; spokenSeconds: number };
  costUsd: number;
  elapsedMs: number;
  judgedAt: string;
}

export interface JudgeError {
  error: string;
}
