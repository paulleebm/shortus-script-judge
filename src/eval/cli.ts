import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadLocalEnv } from "../auth.js";
import type { JudgeRun } from "../judge/index.js";
import { RUBRIC_VERSION } from "../judge/anchors.js";
import { DEFAULT_SPEED, type Speed } from "../judge/llm.js";
import { PROMPT_VERSION } from "../judge/prompts.js";
import { loadScript, type Script } from "../script.js";
import { agreement, formatAgreement, type ScriptComparison } from "./agreement.js";
import { humanScored, parseHumanLabels } from "./labels.js";
import { loadReferences } from "./reference.js";
import { formatReview, type ReviewRun } from "./review.js";
import { createJudge, mapLimit, type Judge } from "./runner.js";
import { compare, formatScorecard, type Comparison, type Labeled } from "./suite.js";
import { evaluateVariant, formatVariants, type VariantResult, type VariantSpec } from "./variants.js";
import { readXlsxRecords } from "./xlsx.js";

const USAGE = `사용법: npm run eval -- <명령> [옵션]
  suite            검증 묶음 전부(방향 시험, 참조 판정 일치, 반복 안정성)를 재고 끝내는 조건과 맞대어 본다
    --stability      대본을 한 번 더 판정해 안정성도 잰다(대본 수만큼 요금)
    --pool <모음>    dev(개발용, 기본) | holdout(끝낼 때 한 번만)
  variants         방향 시험만(data/variants: 결함·개선·대조·편향 변형)
  review           사람이 판정기 결과를 읽고 이의를 다는 검토 문서를 만든다
    --set <세트>     시험 | 개발 | all (기본 시험)
  agreement        판정시트.xlsx의 사람 판정과 판정기 결과를 비교한다(사람 판정을 적은 대본만)
    --set <세트>     시험 | 개발 | 탐색 | all (기본 시험)
  공통
    --record         응답 기록(fixtures/${PROMPT_VERSION}/)이 없는 대본을 실제로 판정해 저장한다(요금 발생)
    --speed <속도>   standard | fast (기본 ${DEFAULT_SPEED}, fast는 2배 요금)
    --concurrency N  한 번에 판정하는 대본 수(기본 3)
    --max-spend N    이번 실행에서 쓸 요금 상한(달러, 기본 10)
    --sheet <파일>   기본 판정시트.xlsx`;

async function save(name: string, text: string): Promise<void> {
  const dir = join("runs", "eval");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${name}-${PROMPT_VERSION}.md`);
  await writeFile(path, `${text}\n`, "utf8");
  console.log(`\n기록: ${path}`);
}

function report(judge: Judge): void {
  if (judge.skipped) console.log(`요금 상한에 닿아 판정하지 않은 대본: ${judge.skipped}개`);
  if (judge.spent) console.log(`이번에 쓴 돈 어림 $${judge.spent.toFixed(2)}`);
}

async function readSets(sheet: string): Promise<Map<string | undefined, string | undefined>> {
  return new Map((await readXlsxRecords(sheet, "대본 정보")).map((row) => [row["대본 ID"], row["세트"]]));
}

/** 검증 묶음을 잴 대본 모음. 개발용은 반복하며 고치는 데 쓰고, 홀드아웃은 끝낼 때 한 번만 쓴다(DECISIONS 19) */
interface Pool {
  name: string;
  scripts: string;
  variants: string;
  references: string;
}

const POOLS: Record<string, Pool> = {
  dev: { name: "개발용", scripts: join("data", "scripts"), variants: join("data", "variants"), references: join("data", "reference", RUBRIC_VERSION) },
  holdout: {
    name: "홀드아웃",
    scripts: join("data", "holdout"),
    variants: join("data", "holdout-variants"),
    references: join("data", "reference", RUBRIC_VERSION, "holdout"),
  },
};

async function poolScripts(pool: Pool): Promise<Script[]> {
  const names = (await readdir(pool.scripts)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(names.map((name) => loadScript(join(pool.scripts, name))));
}

async function judgeAll(judge: Judge, scripts: Script[], concurrency: number, repeat = 1): Promise<Map<string, JudgeRun>> {
  const runs = await mapLimit(scripts, concurrency, (script) => judge.run(script, repeat));
  return new Map(scripts.flatMap((script, index) => (runs[index] ? [[script.id, runs[index]!] as const] : [])));
}

async function runAgreement(judge: Judge, sheet: string, set: string): Promise<void> {
  const sets = await readSets(sheet);
  const labels = parseHumanLabels(await readXlsxRecords(sheet, "사람 판정")).filter((label) => set === "all" || sets.get(label.id) === set);
  if (labels.length === 0) {
    console.log(`'${set}' 세트에 사람 판정을 적은 대본이 아직 없어요(${sheet}의 '사람 판정' 시트).`);
    return;
  }
  const comparisons: ScriptComparison[] = [];
  const missing: string[] = [];
  for (const label of labels) {
    const script = await loadScript(join("data", "scripts", `${label.id}.json`));
    const judged = await judge.run(script);
    if (!judged) {
      missing.push(label.id);
      continue;
    }
    comparisons.push({ id: label.id, human: humanScored(script, label), judge: judged.scored, topicsLabeled: label.topics !== null });
  }
  if (missing.length) console.log(`응답 기록이 없어 뺀 대본: ${missing.join(", ")} (--record를 붙이면 판정해 저장해요)`);
  if (comparisons.length === 0) return;
  const text = formatAgreement(agreement(comparisons), `사람 판정 일치도 · ${set} 세트 · 프롬프트 ${PROMPT_VERSION}`);
  console.log(text);
  await save(`agreement-${set}`, text);
}

async function runReview(judge: Judge, sheet: string, set: string): Promise<void> {
  const sets = await readSets(sheet);
  const ids = [...sets].filter(([id, rowSet]) => id && (set === "all" || rowSet === set)).map(([id]) => id as string);
  if (ids.length === 0) {
    console.log(`${sheet}의 '대본 정보'에 '${set}' 세트 대본이 없어요.`);
    return;
  }
  const entries: { script: Script; run: ReviewRun }[] = [];
  const missing: string[] = [];
  for (const id of ids.sort()) {
    const script = await loadScript(join("data", "scripts", `${id}.json`));
    const run = await judge.run(script);
    if (run) entries.push({ script, run });
    else missing.push(id);
  }
  if (missing.length) console.log(`응답 기록이 없어 뺀 대본: ${missing.join(", ")} (--record를 붙이면 판정해 저장해요)`);
  if (entries.length === 0) return;
  await save(`review-${set}`, formatReview(entries, `판정기 결과 검토 · ${set} 세트 · 프롬프트 ${PROMPT_VERSION}`));
}

async function variantResults(judge: Judge, concurrency: number, bases: Map<string, JudgeRun>, pool: Pool): Promise<VariantResult[]> {
  const manifest = await readFile(join(pool.variants, "manifest.json"), "utf8").catch(() => "[]");
  const specs = JSON.parse(manifest) as VariantSpec[];
  const scripts = await Promise.all(specs.map((spec) => loadScript(join(pool.variants, `${spec.id}.json`))));
  const runs = await judgeAll(judge, scripts, concurrency);
  const results: VariantResult[] = [];
  const missing: string[] = [];
  for (const spec of specs) {
    const base = bases.get(spec.base);
    const variant = runs.get(spec.id);
    if (!base || !variant) missing.push(spec.id);
    else results.push(evaluateVariant(spec, base.scored, variant.scored));
  }
  if (missing.length) console.log(`응답 기록이 없어 뺀 변형: ${missing.join(", ")}`);
  return results;
}

async function runVariants(judge: Judge, concurrency: number, pool: Pool): Promise<void> {
  const bases = await judgeAll(judge, await poolScripts(pool), concurrency);
  const results = await variantResults(judge, concurrency, bases, pool);
  if (results.length === 0) return;
  const text = formatVariants(results, `방향 시험 · 프롬프트 ${PROMPT_VERSION}`);
  console.log(text);
  await save(pool === POOLS.dev ? "variants" : `variants-${pool.name}`, text);
}

async function runSuite(judge: Judge, concurrency: number, stability: boolean, pool: Pool): Promise<void> {
  const scripts = await poolScripts(pool);
  const bases = await judgeAll(judge, scripts, concurrency);
  const variants = await variantResults(judge, concurrency, bases, pool);

  const judgeLabels: Labeled[] = [...bases].map(([id, run]) => ({ id, scored: run.scored }));
  const byId = new Map(scripts.map((script) => [script.id, script]));
  const raters = (await loadReferences(pool.references)).map((reference) => ({
    name: reference.rater,
    labels: reference.labels.flatMap((label): Labeled[] => {
      const script = byId.get(label.id);
      return script ? [{ id: label.id, scored: humanScored(script, label) }] : [];
    }),
  }));
  const judgeVsRaters: Comparison[] = raters.map((rater) => compare(rater.name, rater.labels, "판정기", judgeLabels));
  const raterPairs: Comparison[] = raters.flatMap((a, i) => raters.slice(i + 1).map((b) => compare(a.name, a.labels, b.name, b.labels)));

  // --stability가 없으면 이미 기록한 두 번째 판정만 쓴다(요금 없음)
  const repeatJudge = stability ? judge : createJudge({ record: false, speed: "standard", concurrency, maxSpend: 0 });
  const repeats = await judgeAll(repeatJudge, scripts, concurrency, 2);
  const repeatComparison =
    repeats.size > 0
      ? compare(
          "판정 1",
          judgeLabels.filter((label) => repeats.has(label.id)),
          "판정 2",
          [...repeats].map(([id, run]) => ({ id, scored: run.scored })),
        )
      : null;

  const card = formatScorecard({ version: `${PROMPT_VERSION} · ${pool.name}`, variants, judgeVsRaters, raterPairs, stability: repeatComparison });
  console.log(card);
  await save(pool === POOLS.dev ? "suite" : `suite-${pool.name}`, `${card}\n\n${formatVariants(variants, "방향 시험")}`);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      set: { type: "string", default: "시험" },
      sheet: { type: "string", default: "판정시트.xlsx" },
      record: { type: "boolean", default: false },
      speed: { type: "string", default: DEFAULT_SPEED },
      concurrency: { type: "string", default: "3" },
      "max-spend": { type: "string", default: "10" },
      stability: { type: "boolean", default: false },
      pool: { type: "string", default: "dev" },
    },
  });
  const speed = values.speed as Speed;
  if (speed !== "standard" && speed !== "fast") throw new Error(`--speed는 standard나 fast예요: ${values.speed}`);
  const concurrency = Math.max(1, Number(values.concurrency) || 1);
  const judge = createJudge({ record: values.record, speed, concurrency, maxSpend: Number(values["max-spend"]) || 0 });
  const pool = POOLS[values.pool];
  if (!pool) throw new Error(`--pool은 dev나 holdout이에요: ${values.pool}`);
  const command = positionals[0];
  if (command === "agreement") await runAgreement(judge, values.sheet, values.set);
  else if (command === "review") await runReview(judge, values.sheet, values.set);
  else if (command === "variants") await runVariants(judge, concurrency, pool);
  else if (command === "suite") await runSuite(judge, concurrency, values.stability, pool);
  else {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  report(judge);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
