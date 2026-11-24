import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

/**
 * 판정시트.xlsx를 읽는 최소한의 리더. 라이브러리를 더하지 않으려고 zip과 시트 XML만 직접 읽는다.
 * 값은 모두 글자로 돌려준다(숫자 칸도 "3"). 서식·수식은 보지 않는다.
 */

/** zip 안의 파일 이름 → 내용 */
export function readZip(buffer: Buffer): Map<string, Buffer> {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("xlsx(zip) 형식이 아니에요");

  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error("zip 목록이 깨졌어요");
    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString("utf8", pointer + 46, pointer + 46 + nameLength);

    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const data = buffer.subarray(start, start + compressedSize);
    if (method === 0) entries.set(name, data);
    else if (method === 8) entries.set(name, inflateRawSync(data));
    else throw new Error(`${name}: 지원하지 않는 압축 방식(${method})`);
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textOf(xml: string): string {
  return decodeXml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(""));
}

/** 시트 이름으로 찾아 행 목록을 돌려준다. 행마다 열 글자(A, B, …) → 값 */
export function readSheet(entries: Map<string, Buffer>, sheetName: string): Record<string, string>[] {
  const read = (path: string) => entries.get(path)?.toString("utf8");
  const workbook = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels");
  if (!workbook || !rels) throw new Error("xlsx 안에 workbook이 없어요");

  const sheet = [...workbook.matchAll(/<sheet\b[^>]*>/g)].map((match) => match[0]).find((tag) => decodeXml(/name="([^"]*)"/.exec(tag)?.[1] ?? "") === sheetName);
  if (!sheet) throw new Error(`'${sheetName}' 시트가 없어요`);
  const relId = /r:id="([^"]*)"/.exec(sheet)?.[1];
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(`Id="${relId}"`));
  const target = rel && /Target="([^"]*)"/.exec(rel)?.[1];
  if (!target) throw new Error(`'${sheetName}' 시트 파일을 찾지 못했어요`);
  const xml = read(target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  if (!xml) throw new Error(`'${sheetName}' 시트 파일이 비었어요`);

  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]!));
  const rows = new Map<number, Record<string, string>>();
  for (const match of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const [, column, row, attributes, inner] = match;
    if (!inner) continue;
    const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
    let value: string;
    if (/t="s"/.test(attributes!)) value = shared[Number(raw)] ?? "";
    else if (/t="inlineStr"/.test(attributes!)) value = textOf(inner);
    else value = decodeXml(raw ?? "");
    value = value.trim();
    if (!value) continue;
    const record = rows.get(Number(row)) ?? {};
    record[column!] = value;
    rows.set(Number(row), record);
  }
  return [...rows.entries()].sort(([a], [b]) => a - b).map(([, record]) => record);
}

/** 첫 행을 머리글로 써서 머리글 → 값 레코드로 바꾼다 */
export function toRecords(rows: Record<string, string>[]): Record<string, string>[] {
  const [header, ...body] = rows;
  if (!header) return [];
  return body.map((row) => Object.fromEntries(Object.entries(header).map(([column, name]) => [name, row[column] ?? ""])));
}

export async function readXlsxRecords(path: string, sheetName: string): Promise<Record<string, string>[]> {
  return toRecords(readSheet(readZip(await readFile(path)), sheetName));
}
