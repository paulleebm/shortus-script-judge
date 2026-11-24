// 평가자에게 줄 확장 zip을 만든다(DECISIONS 23). 평가자는 풀어서 '압축해제된 확장 프로그램'으로 불러온다.
// 실행: node scripts/package-extension.mjs https://<기기 이름>.<tailnet 이름>.ts.net
//   - 그 주소를 확장에 넣어 빌드하고, 매니페스트의 host_permissions를 그 주소로 바꾼다
//   - 결과: runs/release/pkg(풀어 둔 것), runs/release/shortus-judge-extension-<버전>.zip
//   - 주소를 빼면 이 PC의 로컬 판정 서버(http://127.0.0.1:8787)로 만든다
//   - 매니페스트의 key 덕분에 어느 폴더에서 불러와도 확장 ID가 같다(서버가 그 ID만 받는다)
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32 } from "node:zlib";
import { buildExtension } from "./build-extension.mjs";

const serverUrl = (process.argv[2] ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const url = new URL(serverUrl);
const local = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
if (url.protocol !== "https:" && !local) {
  console.error(`공개 서버 주소는 https여야 해요: ${serverUrl}`);
  process.exit(1);
}

const out = join("runs", "release", "pkg");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await buildExtension({ outdir: join(out, "dist"), serverUrl });
cpSync(join("extension", "icons"), join(out, "icons"), { recursive: true });
const manifest = JSON.parse(readFileSync(join("extension", "manifest.json"), "utf8"));
manifest.host_permissions = [`${url.origin}/*`];
if (!local) manifest.description = "쇼더스 Studio 2단계 대본을 렌더 전에 판정해 점수와 다시 만들 섹션을 보여 주는 비공식 도구입니다. 판정은 개발자의 판정 서버가 합니다.";
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

/** 압축하지 않고 담는(stored) zip. 경로는 슬래시로 쓴다 */
function zip(root) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push({ name: relative(root, path).split("\\").join("/"), data: readFileSync(path) });
    }
  };
  walk(root);
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 이름
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, file.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(file.data.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + file.data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return { buffer: Buffer.concat([...locals, ...centrals, end]), names: files.map((file) => file.name) };
}

const { buffer, names } = zip(out);
const zipPath = join("runs", "release", `shortus-judge-extension-${manifest.version}.zip`);
writeFileSync(zipPath, buffer);
console.log(`${zipPath} (${buffer.length} bytes) · 서버 ${serverUrl}`);
console.log(names.map((name) => `  ${name}`).join("\n"));
