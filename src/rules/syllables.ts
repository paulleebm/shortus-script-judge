/**
 * 내레이션을 소리 내어 읽을 때의 음절 수를 어림한다.
 * 첫 3초를 잘라 낼 때 '초당 음절'을 구하는 데만 쓰므로 정확한 발음 규칙이 아니라 근사다.
 * - 한글: 글자 하나가 한 음절
 * - 숫자: 한자어로 읽는다고 본다(2026 → 이천이십육, 3.58 → 삼점오팔)
 * - 영문 약어: 글자 이름으로 읽는다(CEO → 씨이오), 일반 영단어는 모음 덩어리 수
 * - %: 퍼센트
 */

const LETTER_SYLLABLES: Record<string, number> = {
  A: 2, B: 1, C: 1, D: 1, E: 1, F: 2, G: 1, H: 3, I: 2, J: 2, K: 2, L: 1, M: 1,
  N: 1, O: 1, P: 1, Q: 1, R: 1, S: 2, T: 1, U: 1, V: 2, W: 3, X: 2, Y: 2, Z: 1,
};

const TOKEN = /(\d+(?:[.,]\d+)*)|([A-Za-z]+)|([가-힣])|(%)/g;

export function countSpokenSyllables(text: string): number {
  let total = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [, number, latin, hangul, percent] = match;
    if (number) total += countNumberSyllables(number);
    else if (latin) total += countLatinSyllables(latin);
    else if (hangul) total += 1;
    else if (percent) total += 3;
  }
  return total;
}

export function countNumberSyllables(token: string): number {
  const [integerPart = "", ...decimalParts] = token.split(".");
  let count = countIntegerSyllables(integerPart.replace(/,/g, ""));
  const decimals = decimalParts.join("").replace(/,/g, "");
  if (decimals.length > 0) count += 1 + decimals.length; // '점' + 숫자를 하나씩
  return count;
}

export function countIntegerSyllables(digits: string): number {
  const value = digits.replace(/^0+/, "");
  if (value === "") return 1; // 영

  const groups: string[] = [];
  for (let end = value.length; end > 0; end -= 4) {
    groups.unshift(value.slice(Math.max(0, end - 4), end));
  }

  let total = 0;
  groups.forEach((group, index) => {
    const isOnesGroup = index === groups.length - 1;
    const isManGroup = index === groups.length - 2;
    const padded = group.padStart(4, "0");
    if (isManGroup && Number(padded) === 1) {
      total += 1; // '일만'이 아니라 '만'
      return;
    }
    let count = 0;
    for (let i = 0; i < 4; i++) {
      const digit = padded[i];
      const place = 3 - i; // 3: 천, 2: 백, 1: 십, 0: 일
      if (digit === "0") continue;
      count += (digit === "1" && place > 0 ? 0 : 1) + (place > 0 ? 1 : 0);
    }
    if (count > 0 && !isOnesGroup) count += 1; // 만, 억, 조
    total += count;
  });
  return total;
}

export function countLatinSyllables(word: string): number {
  const isAcronym = word === word.toUpperCase() && word.length <= 5;
  if (isAcronym) {
    return [...word].reduce((sum, letter) => sum + (LETTER_SYLLABLES[letter] ?? 1), 0);
  }
  return Math.max(1, word.match(/[aeiouy]+/gi)?.length ?? 1);
}
