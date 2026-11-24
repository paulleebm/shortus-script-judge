// 크롬 확장 빌드: extension/src → extension/dist (압축 해제된 확장으로 extension 폴더를 불러온다)
// 서버 주소는 JUDGE_SERVER_URL로 바꿀 수 있다(기본 이 PC의 로컬 판정 서버). 평가자용 zip은 scripts/package-extension.mjs
import { build } from "esbuild";
import { pathToFileURL } from "node:url";

export async function buildExtension({ outdir = "extension/dist", serverUrl = process.env.JUDGE_SERVER_URL || "http://127.0.0.1:8787" } = {}) {
  await build({
    entryPoints: {
      content: "extension/src/content.ts",
      background: "extension/src/background.ts",
    },
    outdir,
    bundle: true,
    format: "iife",
    target: "chrome114",
    logLevel: "info",
    define: { __JUDGE_SERVER__: JSON.stringify(serverUrl) },
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await buildExtension();
}
