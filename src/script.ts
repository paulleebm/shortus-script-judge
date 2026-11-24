import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * 쇼더스 2단계 화면의 섹션 역할 태그. 자주 보이는 것은 훅·포인트·행동 유도지만
 * 대본 형식에 따라 '통계' 같은 다른 태그도 나와서(2026-11-11 S05) 목록으로 막지 않는다.
 */
export const SectionSchema = z.object({
  order: z.number().int().positive(),
  role: z.string().trim().min(1),
  narration: z.string().trim().min(1),
  seconds: z.number().positive(),
});

export const ScriptSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    source: z
      .object({
        type: z.string(),
        title: z.string().optional(),
        url: z.string().optional(),
        note: z.string().optional(),
      })
      .optional(),
    sections: z.array(SectionSchema).min(2),
  })
  .refine((script) => script.sections.every((section, index) => section.order === index + 1), {
    message: "섹션 order는 1부터 차례대로 이어져야 해요",
  });

export type Section = z.infer<typeof SectionSchema>;
export type Script = z.infer<typeof ScriptSchema>;

export async function loadScript(path: string): Promise<Script> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  return ScriptSchema.parse(raw);
}

export function getSection(script: Script, order: number): Section | undefined {
  return script.sections.find((section) => section.order === order);
}

export function totalSeconds(script: Script): number {
  return script.sections.reduce((sum, section) => sum + section.seconds, 0);
}
