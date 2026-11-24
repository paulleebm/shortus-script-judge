/**
 * LLM이 인용한 구절이 대본에 글자 그대로 있는지 확인한다.
 * 띄어쓰기, 따옴표, 문장부호 차이는 무시한다.
 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/\s+/g, "")
    .replace(/["'“”‘’「」『』]/g, "")
    .replace(/[.,!?…·~]/g, "");
}

export function isQuoteIn(quote: string | null | undefined, ...sources: (string | undefined)[]): boolean {
  if (!quote) return false;
  const needle = normalizeForMatch(quote);
  if (needle.length === 0) return false;
  return sources.some((source) => source !== undefined && normalizeForMatch(source).includes(needle));
}
