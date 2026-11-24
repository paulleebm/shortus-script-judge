import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { oidcFederationProvider } from "@anthropic-ai/sdk/lib/credentials/oidc-federation";

const execAsync = promisify(exec);

/**
 * 신원 토큰(JWT)을 그때그때 새로 받아 오는 명령.
 * 예: gcloud auth print-identity-token --impersonate-service-account=... --audiences=https://api.anthropic.com --include-email
 * 설정하면 토큰 교환 때마다 이 명령을 실행해 새 토큰을 쓴다(Google 신원 토큰은 1시간이면 만료된다).
 */
export const TOKEN_COMMAND_ENV = "JUDGE_IDENTITY_TOKEN_COMMAND";

export const AUTH_ENV_NAMES = [
  "ANTHROPIC_FEDERATION_RULE_ID",
  "ANTHROPIC_ORGANIZATION_ID",
  "ANTHROPIC_SERVICE_ACCOUNT_ID",
  "ANTHROPIC_WORKSPACE_ID",
  "ANTHROPIC_IDENTITY_TOKEN_FILE",
  "ANTHROPIC_IDENTITY_TOKEN",
  TOKEN_COMMAND_ENV,
] as const;

/** 저장소 밖으로 나가지 않는 로컬 설정 파일. 페더레이션 ID들을 여기에 둔다(.gitignore 대상). */
export function loadLocalEnv(path = ".env.local"): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

/**
 * API 클라이언트를 만든다. 키는 코드에 넣지 않는다.
 * - JUDGE_IDENTITY_TOKEN_COMMAND가 있으면: 그 명령으로 받은 JWT를 Workload Identity Federation으로 교환한다.
 * - 없으면: new Anthropic()이 환경 변수(ANTHROPIC_FEDERATION_RULE_ID 등과 ANTHROPIC_IDENTITY_TOKEN_FILE)나 `ant auth login` 프로필을 찾는다.
 */
export function createClient(env: NodeJS.ProcessEnv = process.env): Anthropic {
  const command = env[TOKEN_COMMAND_ENV];
  if (!command) return new Anthropic();

  return new Anthropic({
    credentials: oidcFederationProvider({
      identityTokenProvider: () => runTokenCommand(command),
      federationRuleId: required(env, "ANTHROPIC_FEDERATION_RULE_ID"),
      organizationId: required(env, "ANTHROPIC_ORGANIZATION_ID"),
      serviceAccountId: env.ANTHROPIC_SERVICE_ACCOUNT_ID || undefined,
      workspaceId: env.ANTHROPIC_WORKSPACE_ID || undefined,
      baseURL: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
      fetch,
    }),
  });
}

export async function runTokenCommand(command: string): Promise<string> {
  const { stdout } = await execAsync(command, { windowsHide: true, timeout: 60_000 });
  const token = stdout.trim();
  if (token.split(".").length !== 3) {
    throw new Error(`${TOKEN_COMMAND_ENV} 명령의 출력이 JWT 형식이 아니에요. 명령을 터미널에서 직접 실행해 확인하세요.`);
  }
  return token;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${TOKEN_COMMAND_ENV}를 쓰려면 ${name}도 설정해야 해요.`);
  return value;
}
