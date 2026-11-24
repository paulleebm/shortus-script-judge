import { describe, expect, it } from "vitest";
import { createClient, runTokenCommand, TOKEN_COMMAND_ENV } from "../src/auth.js";

describe("신원 토큰 명령", () => {
  it("명령의 출력에서 JWT를 읽는다", async () => {
    await expect(runTokenCommand(`node -e "console.log('aaa.bbb.ccc')"`)).resolves.toBe("aaa.bbb.ccc");
  });

  it("JWT 형식이 아니면 멈춘다", async () => {
    await expect(runTokenCommand(`node -e "console.log('not-a-token')"`)).rejects.toThrow("JWT 형식이 아니에요");
  });

  it("명령을 쓰는데 규칙 ID가 없으면 클라이언트를 만들지 않는다", () => {
    expect(() => createClient({ [TOKEN_COMMAND_ENV]: "echo a.b.c", ANTHROPIC_ORGANIZATION_ID: "org" })).toThrow(
      "ANTHROPIC_FEDERATION_RULE_ID",
    );
  });

  it("필요한 ID가 있으면 네트워크 없이 클라이언트를 만든다", () => {
    const client = createClient({
      [TOKEN_COMMAND_ENV]: "echo a.b.c",
      ANTHROPIC_FEDERATION_RULE_ID: "fdrl_test",
      ANTHROPIC_ORGANIZATION_ID: "00000000-0000-0000-0000-000000000000",
    });
    expect(client).toBeDefined();
  });
});
