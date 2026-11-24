# shortus-script-judge

쇼더스(ShortUs) 2단계 '대본과 나레이션' 결과물을 렌더 전에 판정하는 판정기. 패스트뷰 AI Engineer 사전 과제다(제출 2026-11-24 23:59, 메일 회신).

## 원칙
- 결정은 DECISIONS.md에 시간순으로 남긴다. 사용자가 정한 것은 "(날짜 사용자)", 제안만 한 것은 "(Claude 제안)"으로 적고, 뒤집은 결정도 지우지 않는다.
- 판정 기준(질문과 단계 기준표)은 `src/judge/anchors.ts`와 DECISIONS.md 8번이 같아야 한다. 하나를 고치면 둘 다 고친다.
- 뼈대는 Node + TypeScript CLI다. 크롬 확장은 판정 핵심이 검증된 뒤 이 코드를 가져다 쓴다(2026-11-11 사용자: 확장으로 구현하되 판정 핵심은 분리).
- 모델은 `claude-opus-5-5`. 인증 정보는 코드와 저장소에 두지 않고 환경에서 읽는다(Workload Identity Federation 예정, 2026-11-11 사용자).
- 실제 API 호출은 비용이 든다. 먼저 테스트(가짜 응답)와 `--replay`로 확인하고, 실제 호출은 사용자가 원할 때만 한다.
- `fixtures/`의 응답은 실제 모델 응답만 둔다. 손으로 만든 가짜 응답은 테스트 파일 안에만 둔다.
- 판정시트.xlsx의 사람 판정은 판정기 결과를 보기 전에 적는다.
- 커밋은 사용자가 요청할 때 한다.

## 확인하는 법
- `npm test`
- `npm run typecheck`
- `npm run judge -- data/scripts/S00.json --replay` (fixtures가 있을 때)
