import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { JudgeRequestSchema, type JudgeRequest, type JudgeResponse } from "./api.js";
import { loadLocalEnv } from "./auth.js";
import { judgeScript, type JudgeRun } from "./judge/index.js";
import { createAnthropicCaller, createReplayCaller, DEFAULT_EFFORT, DEFAULT_SPEED, MODEL, type Effort, type LlmCaller, type Speed } from "./judge/llm.js";
import { PROMPT_VERSION } from "./judge/prompts.js";
import { writeRun } from "./report.js";
import { ScriptSchema, type Script } from "./script.js";

/**
 * 크롬 확장이 부르는 판정 서버.
 * 확장에는 인증 정보를 둘 수 없어서, API 호출은 이 서버가 맡는다.
 * - 기본은 127.0.0.1에만 열고, Origin이 chrome-extension:// 인 요청만 받는다(다른 웹사이트가 몰래 판정을 돌려 요금을 쓰지 못하게)
 * - 공개 서버(미니 PC의 Docker, DECISIONS 22)에서는 받을 확장 ID를 정하고, IP마다 시간당 새 판정 수와 하루 요금 상한을 둔다.
 *   Origin은 브라우저 밖에서 꾸밀 수 있으므로 요금을 실제로 막는 것은 하루 상한이다
 * - 같은 대본은 다시 부르지 않고 저장한 결과를 돌려준다
 * - --replay: API를 부르지 않고 data/scripts의 대본과 같은 내용이면 저장된 응답(fixtures)으로 판정한다(데모 모드)
 */
export interface ServerOptions {
  replay?: boolean;
  model?: string;
  effort?: Effort;
  speed?: Speed;
  /** 테스트에서 가짜 호출기를 넣는다 */
  caller?: LlmCaller;
  cacheDir?: string;
  runsDir?: string;
  scriptsDir?: string;
  fixturesRoot?: string;
  /** Origin 없는 요청(터미널·테스트)을 받을지 */
  allowNoOrigin?: boolean;
  /** 받을 확장 ID. 비우면 모든 chrome-extension:// 을 받는다(로컬 개발). 공개 서버에서는 스토어 확장 ID만 받는다 */
  extensionIds?: string[];
  /** 하루(한국 시간) 새 판정 요금 상한(달러). 0이나 비우면 없음. 저장된 결과는 상한과 상관없이 돌려준다 */
  dailyBudgetUsd?: number;
  /** IP마다 한 시간에 시작할 수 있는 새 판정 수. 0이나 비우면 없음 */
  ratePerHour?: number;
  /** 앞에 리버스 프록시(Tailscale Funnel)가 있으면 X-Forwarded-For의 첫 주소를 손님 IP로 쓴다 */
  trustProxy?: boolean;
  /** 지금 시각(테스트용) */
  now?: () => number;
}

/** 판정 하나를 시작할 때 하루 상한에서 미리 잡아 두는 요금(고속 판정 약 $0.36보다 조금 크게) */
const RESERVE_USD = 0.4;

const MAX_BODY = 200_000;

export function contentKey(request: JudgeRequest): string {
  const normalized = [
    PROMPT_VERSION,
    request.title.trim(),
    request.sections.map((section) => [section.order, section.role.trim(), section.narration.trim(), section.seconds]),
  ];
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

export function toScript(request: JudgeRequest, id: string): Script {
  return ScriptSchema.parse({ id, title: request.title, sections: request.sections });
}

export function toResponse(run: JudgeRun, key: string, cached: boolean): JudgeResponse {
  const items = [run.scored.watch, run.scored.engage, run.scored.affinity].flatMap((group) => group.items);
  return {
    key,
    cached,
    promptVersion: run.promptVersion,
    model: run.model,
    groups: { watch: run.scored.watch.score, engage: run.scored.engage.score, affinity: run.scored.affinity.score },
    items: items.map((item) => ({
      id: item.id,
      label: item.label,
      kind: item.kind,
      level: item.level,
      status: item.status,
      section: item.section,
      reason: item.reason,
      evidence: item.evidence,
      ...(item.audit ? { audit: item.audit } : {}),
    })),
    regenerate: run.scored.regenerate,
    policyRisk: run.scored.policyRisk,
    audit: {
      checked: items.filter((item) => item.audit).length,
      suspicious: items.filter((item) => item.audit?.verdict === "의심").length,
      overall: run.auditOverall,
    },
    opening: { text: run.opening.text, spokenSeconds: run.opening.spokenSeconds },
    costUsd: run.costUsd,
    elapsedMs: run.elapsedMs,
    judgedAt: run.startedAt,
  };
}

export function createJudgeServer(options: ServerOptions = {}): Server {
  const cacheDir = options.cacheDir ?? join("runs", "ext-cache");
  const runsDir = options.runsDir ?? "runs";
  const scriptsDir = options.scriptsDir ?? join("data", "scripts");
  const fixturesRoot = options.fixturesRoot ?? join("fixtures", PROMPT_VERSION);
  const inflight = new Map<string, Promise<JudgeResponse>>();
  let liveCaller: LlmCaller | undefined = options.caller;
  const live = !(options.replay && !options.caller);
  const now = options.now ?? Date.now;
  const spendFile = join(runsDir, "server-spend.json");
  const recent = new Map<string, number[]>();
  let reserved = 0;

  const today = () => new Date(now() + 9 * 3_600_000).toISOString().slice(0, 10);

  async function spentToday(): Promise<number> {
    try {
      const saved = JSON.parse(await readFile(spendFile, "utf8")) as { day: string; usd: number };
      return saved.day === today() ? saved.usd : 0;
    } catch {
      return 0;
    }
  }

  async function addSpend(usd: number): Promise<void> {
    const total = Math.round(((await spentToday()) + usd) * 10_000) / 10_000;
    await mkdir(runsDir, { recursive: true });
    await writeFile(spendFile, JSON.stringify({ day: today(), usd: total }), "utf8");
  }

  function clientIp(req: IncomingMessage): string {
    if (options.trustProxy) {
      const header = req.headers["x-forwarded-for"];
      const first = (Array.isArray(header) ? header[0] : header)?.split(",")[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  /** 새 판정을 시작해도 되는지 본다. 안 되면 429 */
  async function admit(req: IncomingMessage): Promise<void> {
    if (!live) return;
    const limit = options.ratePerHour ?? 0;
    if (limit > 0) {
      const ip = clientIp(req);
      const since = now() - 3_600_000;
      const times = (recent.get(ip) ?? []).filter((time) => time > since);
      if (times.length >= limit) throw new HttpError(429, "판정 요청이 많아요. 한 시간쯤 뒤에 다시 시도해 주세요.");
      times.push(now());
      recent.set(ip, times);
    }
    const budget = options.dailyBudgetUsd ?? 0;
    if (budget > 0 && (await spentToday()) + reserved + RESERVE_USD > budget) {
      throw new HttpError(429, "오늘 판정 한도에 닿았어요. 내일 다시 시도해 주세요. 이미 판정한 대본은 계속 볼 수 있어요.");
    }
  }

  async function readCache(key: string): Promise<JudgeResponse | null> {
    try {
      return { ...(JSON.parse(await readFile(join(cacheDir, `${key}.json`), "utf8")) as JudgeResponse), cached: true };
    } catch {
      return null;
    }
  }

  /**
   * 데모 모드: 요청과 내용이 같은 저장 대본 가운데 응답 기록(fixtures)이 있는 것을 찾는다.
   * data/scripts에는 아직 판정하지 않은 대본(시험용)도 있으므로 응답 기록이 있는지까지 본다.
   */
  async function findRecordedScript(key: string): Promise<Script | null> {
    for (const file of (await readdir(scriptsDir)).filter((name) => name.endsWith(".json"))) {
      const saved = ScriptSchema.parse(JSON.parse(await readFile(join(scriptsDir, file), "utf8")));
      if (contentKey({ title: saved.title, sections: saved.sections }) !== key) continue;
      try {
        await access(join(fixturesRoot, saved.id));
        return saved;
      } catch {
        return null;
      }
    }
    return null;
  }

  async function judge(request: JudgeRequest, key: string): Promise<JudgeResponse> {
    let script: Script;
    let caller: LlmCaller;
    if (options.replay && !options.caller) {
      const saved = await findRecordedScript(key);
      if (!saved) throw new HttpError(404, "저장된 판정이 없어요. 데모 모드는 미리 판정해 둔 대본만 보여 줘요.");
      script = saved;
      caller = createReplayCaller(join(fixturesRoot, saved.id));
    } else {
      script = toScript(request, `EXT-${key.slice(0, 8)}`);
      liveCaller ??= createAnthropicCaller({ model: options.model, effort: options.effort ?? DEFAULT_EFFORT, speed: options.speed ?? DEFAULT_SPEED });
      caller = liveCaller;
    }
    const run = await judgeScript(script, caller);
    await writeRun(run, runsDir);
    const response = toResponse(run, key, false);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${key}.json`), JSON.stringify(response, null, 2), "utf8");
    return response;
  }

  return createServer(async (req, res) => {
    try {
      if (!isAllowedOrigin(req, options.allowNoOrigin ?? false, options.extensionIds ?? [])) return send(res, 403, { error: "확장 프로그램에서 온 요청만 받아요." });
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true, promptVersion: PROMPT_VERSION, mode: options.replay ? "replay" : "live" });
      }
      if (req.method === "POST" && url.pathname === "/judge") {
        const parsed = JudgeRequestSchema.safeParse(JSON.parse(await readBody(req)));
        if (!parsed.success) return send(res, 400, { error: "대본 형식이 맞지 않아요." });
        const key = contentKey(parsed.data);

        const cached = await readCache(key);
        if (cached) return send(res, 200, cached);
        if (url.searchParams.get("cacheOnly") === "1") return send(res, 404, { error: "아직 판정한 적 없는 대본이에요." });

        let pending = inflight.get(key);
        if (!pending) {
          await admit(req);
          reserved += RESERVE_USD;
          pending = judge(parsed.data, key)
            .then(async (response) => {
              if (live) await addSpend(response.costUsd);
              return response;
            })
            .finally(() => {
              inflight.delete(key);
              reserved -= RESERVE_USD;
            });
          inflight.set(key, pending);
        }
        return send(res, 200, await pending);
      }
      return send(res, 404, { error: "없는 경로예요." });
    } catch (error) {
      if (error instanceof HttpError) return send(res, error.status, { error: error.message });
      if (error instanceof SyntaxError) return send(res, 400, { error: "JSON이 아니에요." });
      return send(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isAllowedOrigin(req: IncomingMessage, allowNoOrigin: boolean, extensionIds: string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return allowNoOrigin;
  if (extensionIds.length > 0) return extensionIds.some((id) => origin === `chrome-extension://${id}`);
  return origin.startsWith("chrome-extension://");
}

/** 쉼표로 나눈 환경 변수 */
function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, "요청이 너무 커요."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function main(): Promise<void> {
  loadLocalEnv();
  const { values } = parseArgs({
    options: {
      replay: { type: "boolean", default: false },
      port: { type: "string", default: process.env.JUDGE_PORT ?? "8787" },
      host: { type: "string", default: process.env.JUDGE_HOST ?? "127.0.0.1" },
      model: { type: "string", default: MODEL },
      effort: { type: "string", default: DEFAULT_EFFORT },
      speed: { type: "string", default: DEFAULT_SPEED },
    },
  });
  const port = Number(values.port);
  const guards = {
    extensionIds: list(process.env.JUDGE_EXTENSION_IDS),
    dailyBudgetUsd: Number(process.env.JUDGE_DAILY_BUDGET_USD ?? 0) || 0,
    ratePerHour: Number(process.env.JUDGE_RATE_PER_HOUR ?? 0) || 0,
    trustProxy: process.env.JUDGE_TRUST_PROXY === "1",
  };
  const server = createJudgeServer({
    replay: values.replay,
    model: values.model,
    effort: values.effort as Effort,
    speed: values.speed as Speed,
    ...guards,
  });
  server.listen(port, values.host, () => {
    console.log(`판정 서버: http://${values.host}:${port} (${values.replay ? "저장된 응답으로 판정(데모)" : `실제 판정 · ${values.model} · effort ${values.effort}${values.speed === "fast" ? " · 고속" : ""}`}, 프롬프트 ${PROMPT_VERSION})`);
    console.log(
      `받는 확장: ${guards.extensionIds.length ? guards.extensionIds.join(", ") : "모든 chrome-extension://"} · 하루 상한: ${guards.dailyBudgetUsd ? `${guards.dailyBudgetUsd}달러` : "없음"} · IP당 시간당: ${guards.ratePerHour || "제한 없음"}${guards.trustProxy ? " · 프록시 뒤" : ""}`,
    );
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
