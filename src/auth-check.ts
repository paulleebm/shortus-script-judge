import { AUTH_ENV_NAMES, createClient, loadLocalEnv, TOKEN_COMMAND_ENV } from "./auth.js";

/**
 * 인증만 확인한다. 모델 목록 조회는 요금이 들지 않는다.
 * 값은 출력하지 않고, 어떤 이름의 환경 변수가 설정됐는지만 보여 준다.
 */
let present: string[] = [];

async function main(): Promise<void> {
  loadLocalEnv();
  present = AUTH_ENV_NAMES.filter((name) => process.env[name]);
  console.log(`설정된 인증 환경 변수: ${present.length > 0 ? present.join(", ") : "없음"}`);

  const usesCommand = Boolean(process.env[TOKEN_COMMAND_ENV]);
  if (!usesCommand && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)) {
    console.log("주의: ANTHROPIC_API_KEY나 ANTHROPIC_AUTH_TOKEN이 설정돼 있어 페더레이션보다 먼저 쓰여요.");
  }
  console.log(`방식: ${usesCommand ? `${TOKEN_COMMAND_ENV}로 받은 토큰을 페더레이션으로 교환` : "SDK 기본 탐색(환경 변수, ant 로그인 프로필)"}`);

  const client = createClient();
  const page = await client.models.list({ limit: 1 });
  console.log(`인증 성공: 모델 목록을 받았어요(${page.data[0]?.id ?? "목록이 비어 있음"}).`);
}

main().catch((error: unknown) => {
  console.error(`인증 실패: ${error instanceof Error ? error.message : String(error)}`);
  console.error(
    present.length === 0
      ? "인증 정보가 하나도 설정되지 않았어요. .env.example을 .env.local로 복사해 채우세요(docs/wif-setup.md)."
      : "거절 이유는 Claude Console의 Workload identity > 인증 기록(history)에서 볼 수 있어요(docs/wif-setup.md).",
  );
  process.exitCode = 1;
});
