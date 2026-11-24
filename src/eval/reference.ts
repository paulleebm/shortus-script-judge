import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { RUBRIC_VERSION } from "../judge/anchors.js";
import type { HumanLabel } from "./labels.js";

/**
 * 독립 참조 판정(DECISIONS 19): 판정기 답을 보지 않은 판정자가 같은 기준표로 직접 판정한 것.
 * data/reference/<기준표 버전>/<판정자>.json 에 둔다. 기준표를 고치면 새 버전 폴더에 다시 판정한다. scripts/make-rater-pack.ts로 만든 안내서의 답 형식과 같다.
 */
const Level = z.number().int().min(1).max(5);

const ReferenceFile = z.object({
  rater: z.string(),
  /** 판정할 때 쓴 기준표 버전(anchors.ts의 RUBRIC_VERSION) */
  rubric: z.string().optional(),
  labels: z.array(
    z.object({
      id: z.string(),
      watch1: Level,
      watch2: z.array(Level),
      watch3: z.array(Level),
      topics: z.array(z.string()),
      engage2: Level,
      engage3: Level,
      affinity1: Level,
      affinity2: Level,
      policyRisk: z.boolean(),
      reasons: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    }),
  ),
});

export type ReferenceFile = z.infer<typeof ReferenceFile>;

export interface Reference {
  rater: string;
  rubric: string | null;
  labels: HumanLabel[];
  reasons: Map<string, Record<string, string | string[]>>;
}

export function parseReference(raw: unknown): Reference {
  const file = ReferenceFile.parse(raw);
  return {
    rater: file.rater,
    rubric: file.rubric ?? null,
    labels: file.labels.map((label) => ({
      id: label.id,
      rater: file.rater,
      watch1: label.watch1,
      watch2: label.watch2,
      watch3: label.watch3,
      topics: label.topics.filter((topic) => topic !== "없음"),
      engage2: label.engage2,
      engage3: label.engage3,
      affinity1: label.affinity1,
      affinity2: label.affinity2,
      policyRisk: label.policyRisk,
      overall: null,
    })),
    reasons: new Map(file.labels.map((label) => [label.id, label.reasons ?? {}])),
  };
}

export async function loadReferences(dir = join("data", "reference", RUBRIC_VERSION)): Promise<Reference[]> {
  const names = await readdir(dir).catch(() => [] as string[]);
  const files = names.filter((name) => name.endsWith(".json")).sort();
  return Promise.all(files.map(async (name) => parseReference(JSON.parse(await readFile(join(dir, name), "utf8")))));
}
