/**
 * 방향 시험 세트를 만든다(DECISIONS 17·19).
 * 개발용 대본을 하나씩만 바꿔 data/variants/에 쓰고, 무엇을 바꿨고 어느 항목이 어느 방향으로 움직여야 하는지 manifest.json에 적는다.
 * - D 결함(내려가야 함) · U 개선(올라가야 함) · C 대조(그대로여야 함) · B 편향(오르면 안 됨)
 * 섹션 글을 바꾸면 초도 음절 수에 맞춰 바꾼다(첫 3초 자르기가 쇼더스 화면과 같은 말 속도로 되게).
 * 사실 확인은 판정 대상이 아니므로, 개선 변형에 넣은 수치나 설명은 시험용으로 지어낸 것일 수 있다.
 * 실행: npx tsx scripts/make-variants.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { countSpokenSyllables } from "../src/rules/syllables.js";
import { loadScript, type Script } from "../src/script.js";
import type { VariantGroup, VariantSpec } from "../src/eval/variants.js";

type Change = { replace: Record<number, string> } | { order: number[] };
type Variant = Omit<VariantSpec, "id" | "name" | "group"> & { change: Change };

const NAMES: Record<string, string> = {
  D1: "훅 약화",
  D2: "군더더기",
  D3: "순서 뒤섞기",
  D4: "약속 미이행",
  D5: "쟁점 제거",
  D6: "구체성 제거",
  D7: "답 미리 공개",
  D8: "감정 제거",
  D9: "딴 이야기 끼우기",
  D10: "써먹을 정보 제거",
  U1: "훅 강화",
  U2: "약한 섹션 고쳐 쓰기",
  U3: "쟁점 더하기",
  U4: "약속 채우기",
  U5: "흐름 잇기",
  C1: "바꿔 말하기",
  B1: "꾸밈말 늘리기",
  B2: "자극적 낱말 더하기",
};

const GROUPS: Record<string, VariantGroup> = { D: "결함", U: "개선", C: "대조", B: "편향" };

const VARIANTS: Variant[] = [
  // ── 결함: 17번에서 만든 13개 ──
  { base: "S01", kind: "D1", description: "섹션 1을 주제 소개로 바꿈", target: ["시청1"], change: { replace: { 1: "오늘은 서울 아파트 전세 보증금과 관련된 소식을 알아보겠습니다." } } },
  { base: "S01", kind: "D2", description: "섹션 2(32.1% 통계)를 섹션 1의 되풀이로 바꿈", target: ["시청2-2"], change: { replace: { 2: "7억 넘는 전셋집을 구해도 보증금을 지킬 안전장치를 신청하지 못하는 경우가 있다고 합니다." } } },
  { base: "S01", kind: "D3", description: "섹션 순서를 1, 4, 2, 3으로(결론 같은 지적을 앞에)", target: ["시청3-*"], change: { order: [1, 4, 2, 3] } },
  { base: "S01", kind: "D4", description: "약속에 답하는 섹션 3(왜 신청할 수 없었나)을 일반론으로 바꿈", target: ["호감2"], change: { replace: { 3: "이런 상황에 놓인 세입자들의 걱정도 커지고 있습니다." } } },
  { base: "S01", kind: "D5", description: "쟁점을 제기하는 섹션 4(상한 조정 대안)를 중립 안내로 바꿈", target: ["활동2"], change: { replace: { 4: "전세 계약을 앞두고 있다면 보증금 기준을 미리 확인해 두는 것이 좋습니다." } } },
  { base: "S08", kind: "D1", description: "섹션 1을 인사와 주제 소개로 바꿈", target: ["시청1"], change: { replace: { 1: "안녕하세요, 오늘은 네이트판에 올라온 임산부 배지 이야기를 소개해 드릴게요." } } },
  { base: "S08", kind: "D2", description: "섹션 3(앉을 때만 꺼내는 행동)을 섹션 2의 되풀이로 바꿈", target: ["시청2-3"], change: { replace: { 3: "이 분은 임신 5개월 차라서 보건소에서 받은 배지를 가방에 넣고 다닌다고 해요." } } },
  { base: "S08", kind: "D3", description: "섹션 순서를 1, 5, 4, 2, 3으로(고민과 이유를 앞에)", target: ["시청3-*"], change: { order: [1, 5, 4, 2, 3] } },
  { base: "S11", kind: "D1", description: "섹션 1을 주제 소개로 바꿈", target: ["시청1"], change: { replace: { 1: "오늘은 엔비디아 젠슨 황 CEO와 관련된 소식을 전해 드리겠습니다." } } },
  { base: "S11", kind: "D2", description: "섹션 3(차등의결권 분석)을 섹션 2의 되풀이로 바꿈", target: ["시청2-3"], change: { replace: { 3: "엔비디아 이사회는 황 CEO의 추문을 조사하고 제재 가능성을 검토하고 있습니다." } } },
  { base: "S11", kind: "D4", description: "약속에 답하는 섹션 4(직은 유지해도 권한 분산)를 일반론으로 바꿈", target: ["호감2"], change: { replace: { 4: "업계는 이번 사안이 어떻게 마무리될지 지켜보고 있습니다." } } },
  {
    base: "S05",
    kind: "D4",
    description: "약속에 답하는 섹션 2·4(무엇이 바뀌나)를 일반론으로 바꿈",
    target: ["호감2"],
    change: { replace: { 2: "이번 변화는 지역 경제에 적지 않은 영향을 줄 것으로 보입니다.", 4: "관련 업계에서도 이번 변화를 주목하고 있습니다." } },
  },
  { base: "S00", kind: "D3", description: "섹션 순서를 1, 4, 3, 2로(전망을 분석보다 앞에)", target: ["시청3-*"], change: { order: [1, 4, 3, 2] } },

  // ── 결함: 19번에서 더한 것 ──
  { base: "S02", kind: "D1", description: "섹션 1을 주제 소개로 바꿈", target: ["시청1"], change: { replace: { 1: "오늘은 식당 반찬 재활용과 관련된 판결 소식을 알아보겠습니다." } } },
  { base: "S06", kind: "D1", description: "섹션 1을 주제 소개로 바꿈", target: ["시청1"], change: { replace: { 1: "오늘은 주유와 연비에 관한 이야기를 해 보려고 합니다." } } },
  { base: "S02", kind: "D6", description: "섹션 2의 지역·기간·벌금 액수를 뭉뚱그림", target: ["시청2-2"], change: { replace: { 2: "한 음식점 업주는 남은 음식물을 보관했다가 처벌을 받았습니다." } } },
  { base: "S04", kind: "D6", description: "섹션 3의 유종별 인하율과 적용일을 뭉뚱그림", target: ["시청2-3"], change: { replace: { 3: "이에 따라 다음 달부터 유종별로 유류세 인하가 계속 적용됩니다." } } },
  {
    base: "S03",
    kind: "D6",
    description: "섹션 3의 85g·340g·150g 수치를 뭉뚱그림",
    target: ["시청2-3"],
    change: { replace: { 3: "미국의 육류 권장량보다 실제 식당에서 나오는 양이 훨씬 많고, 한국도 표시된 1인분보다 더 많이 먹는 편이죠." } },
  },
  { base: "S06", kind: "D7", description: "섹션 1에서 결론(가득 넣어도 괜찮다)을 먼저 말함 → 섹션 3이 되풀이가 됨", target: ["시청2-3"], change: { replace: { 1: "결론부터 말하면, 주유할 때 연료를 가득 채워도 연비에는 거의 차이가 없습니다." } } },
  {
    base: "S13",
    kind: "D7",
    description: "섹션 1에서 비법(먼저 볶고 들깨)을 다 말함 → 섹션 3이 되풀이가 됨",
    target: ["시청2-3"],
    change: { replace: { 1: "들깨뭇국은 무를 참기름에 5분간 먼저 볶은 다음 들깻가루를 넣으면 고기 없이도 국물 맛이 깊어집니다." } },
  },
  {
    base: "S09",
    kind: "D8",
    // 2026-11-20 고침: 처음 변형은 글투만 건조하게 바꿔 '사장님이 결제된 음료를 빼먹는' 피해 구도가 남았다. 기준표는 낱말이 아니라 장면과 구도를 보므로 4가 맞았다
    description: "섹션 1·4·5에서 피해 구도를 없앰(사장님이 빠뜨린 것을 알고 바로 차액을 돌려줌)",
    target: ["활동3"],
    change: {
      replace: {
        1: "센터장님이 결제한 음료수가 한 번 빠진 일이 있었어요.",
        4: "사장님은 음료와 당면 추가를 빠뜨린 걸 알고 바로 차액을 돌려주셨죠.",
        5: "글쓴이는 다음에도 그 찜닭집에 가기로 했습니다.",
      },
    },
  },
  {
    base: "S01",
    kind: "D8",
    // 2026-11-20 2바퀴 뒤 고침: 처음 변형은 글투만 건조하게 바꿔 세입자가 보증을 못 받고 비용을 더 무는 손해가 그대로 남았다(S09-D8과 같은 설계 오류)
    description: "섹션 1·3에서 세입자의 손해를 없앰(보증 상품 선택지가 달라질 뿐)",
    target: ["활동3"],
    change: {
      replace: {
        1: "서울에서 7억 넘는 전셋집을 구했다면 이용할 수 있는 보증 상품의 종류가 달라집니다.",
        3: "보증금이 기준을 넘으면 공적 보증 대신 민간 보증 상품 가운데에서 고르게 됩니다.",
      },
    },
  },
  { base: "S12", kind: "D9", description: "섹션 2를 튀르키예 관광 이야기로 바꿈", target: ["시청3-1→2", "시청3-2→3"], change: { replace: { 2: "튀르키예는 매년 수백만 명이 찾는 관광지로, 이스탄불과 카파도키아가 특히 유명합니다." } } },
  { base: "S07", kind: "D9", description: "섹션 3을 편의점 간식 매출 이야기로 바꿈", target: ["시청3-2→3", "시청3-3→4"], change: { replace: { 3: "한편 요즘 편의점에서는 겨울 한정 간식 매출이 크게 늘고 있다고 합니다." } } },
  {
    base: "S13",
    kind: "D10",
    // 2026-11-20 2바퀴 뒤 고침: 처음 변형은 섹션 5에 조리법 요약('먼저 볶아 단맛을 끌어내고 들깨를 더하는')이 남아 결함이 다 들어가지 않았다
    description: "조리법을 담은 섹션 3·4·5를 추억과 재료 소개로 바꿈",
    target: ["호감1"],
    change: {
      replace: {
        3: "어릴 적 할머니가 끓여 주시던 뭇국은 늘 겨울 저녁을 따뜻하게 해 주었습니다.",
        4: "들깨는 예로부터 우리 식탁에서 사랑받아 온 재료입니다.",
        5: "따뜻한 뭇국 한 그릇이 추운 날 저녁을 든든하게 채워 줍니다.",
      },
    },
  },
  {
    base: "S06",
    kind: "D10",
    description: "주유 요령을 담은 섹션 4·5를 '정답은 없다'로 바꿈",
    target: ["호감1"],
    change: { replace: { 4: "주유 습관은 사람마다 다르고 딱 정해진 정답은 없습니다.", 5: "결국 각자 편한 방식으로 주유하면 됩니다." } },
  },
  {
    base: "S04",
    kind: "D4",
    description: "약속에 답하는 섹션 2·3(연장 기간과 인하율)을 일반론으로 바꿈",
    target: ["호감2"],
    change: { replace: { 2: "정부는 유가 흐름을 지켜보며 여러 방안을 검토하고 있습니다.", 3: "관련 업계와 소비자들의 관심도 높아지고 있습니다." } },
  },
  { base: "S00", kind: "D5", description: "쟁점을 제기하는 섹션 2(해임 어렵다 대 잘릴 수 있다)를 중립 안내로 바꿈", target: ["활동2"], change: { replace: { 2: "이사회는 조사 결과를 바탕으로 앞으로의 절차를 정할 예정입니다." } } },
  {
    base: "S03",
    kind: "D5",
    description: "물음을 던지는 섹션 4·5를 중립 안내로 바꿈",
    target: ["활동2"],
    change: { replace: { 4: "음식의 양은 나라마다 문화에 따라 다르게 정해져 왔습니다.", 5: "식당을 고를 때 1인분 표시를 참고해 보세요." } },
  },

  // ── 개선 ──
  { base: "S04", kind: "U1", description: "섹션 1을 손해와 갈등이 드러나는 훅으로", target: ["시청1"], change: { replace: { 1: "12월부터 기름값이 확 오를 뻔했는데, 정부가 또 한 번 막아 섰습니다." } } },
  { base: "S05", kind: "U1", description: "섹션 1을 수치와 나와의 관련이 드러나는 훅으로", target: ["시청1"], change: { replace: { 1: "우리 동네 건설사가 공공 공사를 최대 8천억 원어치 더 따낼 수 있게 됩니다." } } },
  {
    base: "S03",
    kind: "U2",
    description: "약한 섹션 5에 구체적 기준(손바닥 크기)을 더함",
    target: ["시청2-5"],
    change: { replace: { 5: "참고로 미국 심장협회는 고기 한 끼를 손바닥만 한 크기, 카드 한 벌 두께 정도로 권합니다. 여러분의 1인분은 어느 쪽에 가까운가요?" } },
  },
  {
    base: "S04",
    kind: "U2",
    description: "약한 섹션 5(날짜 되풀이)를 연장이 끝난 뒤의 영향으로 바꿈",
    target: ["시청2-5"],
    change: { replace: { 5: "다만 1월 말 이후 연장이 안 되면 휘발유값이 리터당 수십 원 한꺼번에 오를 수 있어, 그 전에 주유 시점을 챙겨 두는 게 좋습니다." } },
  },
  {
    base: "S02",
    kind: "U2",
    description: "약한 섹션 3(법 조항)에 의외의 기준과 처분을 더함",
    target: ["시청2-3"],
    change: { replace: { 3: "식품위생법상 손님 상에 한 번 나갔던 음식은 손을 대지 않았더라도 다시 쓰면 안 되고, 걸리면 영업정지까지 받을 수 있습니다." } },
  },
  {
    base: "S01",
    kind: "U2",
    description: "약한 섹션 4(일반론)를 세입자가 쓰는 대처법으로 바꿈",
    target: ["시청2-4"],
    change: { replace: { 4: "그래서 7억이 넘는 전세라면 계약 전에 보증금 일부를 월세로 돌려 7억 아래로 맞추는 방법이 많이 쓰입니다." } },
  },
  { base: "S12", kind: "U2", description: "약한 섹션 5(일반적 경고)를 구체적 전망으로 바꿈", target: ["시청2-5"], change: { replace: { 5: "연구진은 지금 추세라면 2040년쯤 부르두르호가 완전히 말라 버릴 수 있다고 내다봤습니다." } } },
  {
    base: "S04",
    kind: "U3",
    description: "섹션 4에 높은 인하율을 두고 엇갈리는 평가를 더함",
    target: ["활동2"],
    change: { replace: { 4: "경유와 부탄 인하율을 높게 유지한 것을 두고, 서민 부담을 덜어 준다는 평가와 세수만 줄고 효과는 작다는 비판이 엇갈립니다." } },
  },
  {
    base: "S02",
    kind: "U3",
    description: "섹션 5에 손대지 않은 반찬을 두고 맞서는 의견을 더함",
    target: ["활동2"],
    change: { replace: { 5: "손님이 손도 대지 않은 반찬까지 버려야 하느냐를 두고는 음식물 낭비라는 의견과 위생이 먼저라는 의견이 맞섭니다." } },
  },
  {
    base: "S02",
    kind: "U4",
    description: "섹션 4에 제목이 약속한 방울토마토의 답을 넣음",
    target: ["호감2"],
    change: { replace: { 4: "다만 상추나 방울토마토처럼 씻어서 다시 낼 수 있는 채소는 괜찮지만, 남은 김치나 공깃밥을 공용 통에 합치는 것은 안 됩니다." } },
  },
  {
    base: "S01",
    kind: "U4",
    description: "섹션 3에서 왜 신청할 수 없었는지를 제도 이름으로 분명히 답함",
    target: ["호감2"],
    change: { replace: { 3: "보증금이 7억을 넘으면 주택도시보증공사의 공적 전세보증에 가입할 수 없어서, 세입자가 더 비싼 민간 상품을 쓰거나 월세를 부담해야 합니다." } },
  },
  {
    base: "S08",
    kind: "U4",
    description: "섹션 5에 '이상한가요'에 대한 답(배지는 늘 달아도 된다)을 넣음",
    target: ["호감2"],
    change: { replace: { 5: "임산부 배려 캠페인 측은 배지가 양보를 요구하는 표시가 아니라 도움이 필요할 때를 위한 표시라며, 늘 보이게 달아 두라고 권합니다." } },
  },
  {
    base: "S03",
    kind: "U5",
    // 2026-11-20 고침: 처음 변형은 '이 흐름이 바뀌고 있다'로 훅의 물음(왜 불어나나)에 답하지 않은 채 반대 방향 이야기로 넘어가 흐름이 실제로 나아지지 않았다
    description: "섹션 2 앞에 훅의 물음을 받는 말('답은 1인분의 기준에 있다')을 넣음",
    target: ["시청3-1→2"],
    change: {
      replace: { 2: "답은 '1인분'의 기준에 있습니다. 최근 미국에서는 비만 치료제 사용이 늘어 식사량이 줄자, 외식업계가 양을 줄인 메뉴를 내놓으며 1인분을 다시 정하고 있습니다." },
    },
  },
  {
    base: "S04",
    kind: "U5",
    description: "섹션 5(날짜 되풀이)를 앞 섹션을 받아 다음을 묻는 마무리로 바꿈",
    target: ["시청3-4→5"],
    change: { replace: { 5: "그렇다면 1월 말 이후에는 어떻게 될까요? 정부는 국제 유가 흐름을 보고 추가 연장 여부를 다시 정하기로 했습니다." } },
  },

  // ── 대조: 정보와 장치는 그대로, 말만 바꿈 ──
  {
    base: "S02",
    kind: "C1",
    description: "모든 섹션을 같은 정보로 바꿔 말함",
    target: ["*"],
    change: {
      replace: {
        1: "손님이 남긴 김치와 마늘을 다시 쓰려고 모아 둔 식당 주인이 재판을 받게 됐어요.",
        2: "전북 완주군의 한 식당 주인은 2024년 3월부터 4월 사이 손님이 남긴 음식을 주방 반찬통에 모아 두었다가 벌금 200만 원에 집행유예 1년을 선고받았습니다.",
        3: "식품위생법 시행규칙은 손님이 남겼거나 손님에게 나갔던 음식을 다시 쓰거나 조리해 보관하는 것을 금지합니다.",
        4: "다만 씻어서 다시 낼 수 있는 상추나 통마늘은 괜찮지만, 남은 김치나 공깃밥을 공용 통에 다시 섞는 건 안 됩니다.",
        5: "이를 어기면 3년 이하의 징역이나 3천만 원 이하의 벌금을 받을 수 있습니다.",
      },
    },
  },
  {
    base: "S07",
    kind: "C1",
    description: "모든 섹션을 같은 정보로 바꿔 말함",
    target: ["*"],
    change: {
      replace: {
        1: "시급은 오르는데 근무 시간은 줄어드는 현상 뒤에는 주 15시간이라는 경계선이 있었어요.",
        2: "뉴비즈원 아웃소싱사업본부 본부장은 한 칼럼에서 시급 인상과 초단시간 취업자 수의 관계를 짚었습니다.",
        3: "KDI 분석을 보면 주 15시간 미만으로 일하면 노동비용을 최대 40%까지 아낄 수 있어서, 매장 근무표가 잘게 쪼개지고 있습니다.",
        4: "근무 시간이 쪼개질수록 교육과 소속감, 그리고 매장을 기억해 줄 사람을 잃는 비용도 함께 쪼개집니다.",
      },
    },
  },
  {
    base: "S09",
    kind: "C1",
    description: "모든 섹션을 같은 정보로 바꿔 말함",
    target: ["*"],
    change: {
      replace: {
        1: "센터장님이 매번 돈을 낸 음료수를 저희는 한 번도 받아 본 적이 없어요.",
        2: "신입 사원 네 명은 2주에 한 번씩 찜닭집에서 센터장님이 사 주시는 점심을 먹었대요.",
        3: "센터장님은 그때마다 찜닭 4인분에 음료 두 잔, 당면 추가까지 자기 돈으로 계산했습니다.",
        4: "그런데 사장님은 음료도 안 주고 당면도 안 넣은 채 찜닭만 내놨죠.",
        5: "글쓴이는 사장님이 열세 번 동안 6천 원씩 말없이 가로챈 셈이라며 고민하고 있습니다.",
      },
    },
  },
  {
    base: "S12",
    kind: "C1",
    description: "모든 섹션을 같은 정보로 바꿔 말함",
    target: ["*"],
    change: {
      replace: {
        1: "지구 온난화 때문에 50년 사이 호수 면적의 3분의 1이 사라지는 일이 벌어졌어요.",
        2: "튀르키예 부르두르호의 수위는 지난해 10월 기준으로 1970년보다 21.3미터나 내려갔습니다.",
        3: "기온이 올라 증발량이 늘어난 데다 농업용수를 더 많이 끌어 쓴 것이 함께 영향을 줬습니다.",
        4: "이 지역은 한 사람이 1년에 쓸 수 있는 물이 500세제곱미터도 안 되는 심각한 물 부족 지역입니다.",
        5: "도무쉬 박사는 생태계 전체가 수십 년에 걸쳐 천천히 무너지는 과정이라고 경고했습니다.",
      },
    },
  },
  {
    base: "S13",
    kind: "C1",
    description: "모든 섹션을 같은 정보로 바꿔 말함",
    target: ["*"],
    change: {
      replace: {
        1: "고기나 사골 육수 없이도 국물 맛이 깊은 들깨뭇국에는 무를 다루는 뜻밖의 순서가 있었습니다.",
        2: "무가 원래 가진 단맛과 감칠맛을 차근차근 끌어내면 고기를 넣지 않아도 국물이 풍성해집니다.",
        3: "무를 채 썰어 참기름 두른 냄비에서 5분 동안 천천히 볶으면 무 특유의 풍미가 짙어지고 은은한 단맛이 올라옵니다.",
        4: "여기에 들깻가루를 넣어 끓이면 무의 쌉쌀한 맛을 부드럽게 감싸 주고, 국물에 자연스러운 농도와 묵직한 맛을 더합니다.",
        5: "먼저 볶아서 단맛을 끌어내고 들깨를 더하는 작은 차이가 평범한 뭇국을 깊고 풍성한 국물 요리로 바꿔 줍니다.",
      },
    },
  },

  // ── 편향: 정보는 그대로 두고 꾸밈말이나 자극적 낱말만 더함 ──
  {
    base: "S04",
    kind: "B1",
    description: "섹션 4에 정보 없는 꾸밈말을 더해 길게 만듦",
    target: ["시청2-4"],
    change: {
      replace: {
        4: "산업 현장과 물류 곳곳에 꼭 필요한 경유, 그리고 생계를 위해 매일 달리는 차량에 쓰이는 부탄에 대해서는 높은 인하율을 그대로 유지해, 서민과 산업계의 무거운 부담을 조금이나마 덜어 준다는 방침입니다.",
      },
    },
  },
  {
    base: "S13",
    kind: "B1",
    description: "섹션 2에 정보 없는 꾸밈말을 더해 길게 만듦",
    target: ["시청2-2"],
    change: {
      replace: {
        2: "정성스럽게 고른 무 자체가 가진 은은한 단맛과 깊은 감칠맛을 한 단계 한 단계 차근차근 끌어올리면, 굳이 고기를 넣지 않아도 정말 풍성하고 따뜻한 국물 맛을 완성할 수 있습니다.",
      },
    },
  },
  {
    base: "S06",
    kind: "B1",
    description: "섹션 1에 정보 없는 꾸밈말을 더해 길게 만듦",
    target: ["시청2-1"],
    change: {
      replace: {
        1: "주유소에 들를 때마다 연료를 가득가득 채우면 차량 무게가 늘어나 소중한 연비가 나빠진다는, 많은 운전자들 사이에 오래전부터 전해 내려오는 속설이 있습니다.",
      },
    },
  },
  // 2026-11-20 더함: 편향 변형이 5개라 하나만 흔들려도 20%가 되어 9개로 늘렸다
  {
    base: "S07",
    kind: "B1",
    description: "섹션 2에 정보 없는 꾸밈말을 더해 길게 만듦",
    target: ["시청2-2"],
    change: {
      replace: {
        2: "현장에서 오랫동안 아웃소싱 사업을 이끌어 온 뉴비즈원 아웃소싱사업본부 본부장은 최근 공개한 칼럼을 통해 시급 인상과 초단시간 취업자 수 사이의 흥미로운 상관관계를 꼼꼼하게 짚었습니다.",
      },
    },
  },
  {
    base: "S12",
    kind: "B1",
    description: "섹션 5에 정보 없는 꾸밈말을 더해 길게 만듦",
    target: ["시청2-5"],
    change: {
      replace: {
        5: "현장을 오랫동안 지켜본 도무쉬 박사는 이것이 생태계 전체가 수십 년이라는 긴 시간에 걸쳐 아주 서서히, 그러나 분명하게 훼손되어 가는 과정이라고 진지하게 경고했습니다.",
      },
    },
  },
  {
    base: "S04",
    kind: "B2",
    description: "새 사실 없이 '충격적인', '끔찍한', '숨 막히는' 같은 낱말만 더함",
    target: ["활동3"],
    change: {
      replace: {
        1: "충격적인 중동전쟁과 끔찍한 고유가 상황이 이어지는 가운데 유류세 인하 조치가 어떻게 변할까요?",
        4: "산업과 물류에 필수적인 경유와 생계형 차량용 부탄에 높은 인하율을 유지해 서민과 산업계의 숨 막히는 부담을 완화한다는 방침입니다.",
      },
    },
  },
  {
    base: "S06",
    kind: "B2",
    description: "새 사실 없이 '처참하게', '충격적인', '끔찍한' 같은 낱말만 더함",
    target: ["활동3"],
    change: {
      replace: {
        1: "주유할 때 연료를 가득 채우면 차량 무게가 늘어나 연비가 처참하게 나빠진다는 충격적인 속설이 있습니다.",
        5: "연료를 가득 채우는 것보다 자동 정지 이후 무리하게 기름을 더 넣는 끔찍한 습관을 버리는 게 중요합니다.",
      },
    },
  },
  {
    base: "S07",
    kind: "B2",
    description: "새 사실 없이 '충격', '경악', '씁쓸한' 같은 낱말만 더함",
    target: ["활동3"],
    change: {
      replace: {
        1: "충격적인 사실, 시급은 오르는데 일하는 시간은 줄어드는 현상 뒤에 주 15시간이라는 경계선이 있었어요.",
        3: "KDI 분석에 따르면 15시간 미만 근로 시 노동비용을 최대 40% 줄일 수 있어 매장 근무표가 무참히 쪼개지는 경악스러운 현상이 나타납니다.",
        4: "시간이 쪼개질수록 교육과 소속감 그리고 매장을 기억해 줄 사람을 잃는 비용도 함께 쪼개지는 씁쓸한 현실입니다.",
      },
    },
  },
  {
    base: "S12",
    kind: "B2",
    description: "새 사실 없이 '충격', '끔찍한', '소름 끼치는' 같은 낱말만 더함",
    target: ["활동3"],
    change: {
      replace: {
        1: "충격입니다, 온난화로 인해 50년 새 호수 면적의 3분의 1이 사라지는 끔찍한 일이 벌어졌어요.",
        3: "기온 상승으로 인한 증발량 증가와 농업용수 사용 확대가 복합적으로 작용한 경악스러운 결과입니다.",
        5: "도무쉬 박사는 생태계 전체가 수십 년에 걸쳐 서서히 무너지는 소름 끼치는 과정이라고 경고했습니다.",
      },
    },
  },
];

/**
 * 홀드아웃 변형(DECISIONS 19). 기준을 다 고친 뒤 한 번만 판정한다. 대본을 저장할 때 읽은 글만 보고 만들었고, 홀드아웃의 판정 결과는 보지 않았다.
 * 실행: npx tsx scripts/make-variants.ts holdout
 */
const HOLDOUT_VARIANTS: Variant[] = [
  { base: "H01", kind: "D1", description: "섹션 1을 주제 소개로 바꿈", target: ["시청1"], change: { replace: { 1: "오늘은 대학 논술·면접 시험 감독과 관련된 소식을 전해 드릴게요." } } },
  { base: "H04", kind: "D1", description: "섹션 1을 주제 소개로 바꿈", target: ["시청1"], change: { replace: { 1: "오늘은 우리나라를 찾는 외국인 관광객 이야기를 해 보겠습니다." } } },
  { base: "H02", kind: "D2", description: "섹션 3(현대해상 연간형)을 섹션 2의 되풀이로 바꿈", target: ["시청2-3"], change: { replace: { 3: "KB손해보험은 해외 의료비 보장 한도를 7000만원으로 올린 상품을 새로 내놓았습니다." } } },
  { base: "H01", kind: "D6", description: "섹션 3의 스마트안경·초소형 카메라·금속탐지기를 뭉뚱그림", target: ["시청2-3"], change: { replace: { 3: "대학들은 여러 방법으로 시험장 보안을 강화하고 있습니다." } } },
  { base: "H04", kind: "D6", description: "섹션 4의 지방공항 37.4% 증가를 뭉뚱그림", target: ["시청2-4"], change: { replace: { 4: "지방공항으로 들어오는 외국인도 꽤 늘었습니다." } } },
  { base: "H05", kind: "D3", description: "섹션 순서를 1, 5, 2, 3, 4로(깨달음을 앞에)", target: ["시청3-*"], change: { order: [1, 5, 2, 3, 4] } },
  {
    base: "H02",
    kind: "D4",
    description: "약속(보장·가입 편의 경쟁)에 답하는 섹션 2·3을 일반론으로 바꿈",
    target: ["호감2"],
    change: { replace: { 2: "보험사들은 소비자 요구에 맞춰 다양한 변화를 준비하고 있습니다.", 3: "업계에서도 이런 흐름을 주목하고 있습니다." } },
  },
  { base: "H06", kind: "D9", description: "섹션 3을 스페인 올리브유 이야기로 바꿈", target: ["시청3-2→3", "시청3-3→4"], change: { replace: { 3: "스페인은 올리브유 생산량이 세계에서 가장 많은 나라이기도 합니다." } } },
  {
    base: "H02",
    kind: "U1",
    description: "섹션 1을 손해와 수치가 드러나는 훅으로",
    target: ["시청1"],
    change: { replace: { 1: "해외여행 가서 병원 한 번 가면 수백만 원인데, 이제 여행자보험이 의료비를 7000만원까지 보장해요." } },
  },
  {
    base: "H04",
    kind: "U2",
    description: "섹션 5(일반적인 소비 확산)를 구체적 사례로 바꿈",
    target: ["시청2-5"],
    change: { replace: { 5: "외국인 관광객이 편의점에서 가장 많이 산 상품은 바나나맛 우유로, 1년 새 판매량이 두 배 가까이 늘었습니다." } },
  },
  {
    base: "H07",
    kind: "U2",
    description: "섹션 3(막막했다)을 구체적 장면으로 바꿈",
    target: ["시청2-3"],
    change: { replace: { 3: "처음엔 세금계산서 한 장 끊는 데 반나절이 걸려, 퇴근 후 혼자 엑셀 강의를 찾아봤습니다." } },
  },
  {
    base: "H02",
    kind: "U3",
    description: "섹션 5에 연간형 상품을 두고 엇갈리는 평가를 더함",
    target: ["활동2"],
    change: {
      replace: { 5: "다만 한 번 가입으로 1년을 보장하는 연간형이 정말 이득인지를 두고는, 여행이 잦으면 싸다는 의견과 짧은 여행 한두 번이면 손해라는 의견이 엇갈립니다." },
    },
  },
  {
    base: "H03",
    kind: "C1",
    description: "모든 섹션을 같은 정보로 바꿔 말함",
    target: ["*"],
    change: {
      replace: {
        1: "아이를 낳은 뒤 몸이 예전 같지 않아 팔다리가 끊어지는 듯한 통증을 겪었다는 여배우의 고백이 있었습니다.",
        2: "김모은 배우는 한예종에서 연기를 공부하고 몸을 많이 쓰는 공연을 해 왔지만, 출산 뒤 자존감이 바닥까지 떨어졌습니다.",
        3: "그는 육아와 연습 시간이 겹치는 와중에도 아이 엄마와는 함께 작업 못 하겠다는 말을 들을까 봐 온 힘을 다해 무대에 섭니다.",
        4: "유명해지는 것보다 자기 배역을 멋지게 해내는 것을 목표로, 무명 배우들은 오늘도 무대에서 빛나고 있습니다.",
      },
    },
  },
  {
    base: "H06",
    kind: "C1",
    description: "모든 섹션을 같은 정보로 바꿔 말함",
    target: ["*"],
    change: {
      replace: {
        1: "멋진 풍경을 즐기며 걷다가 이정표를 놓쳐 길을 잃어버리는 일이 생겼어요.",
        2: "글쓴이는 동행인 조셉과 함께 스페인 까미노 길을 걷기 시작했습니다.",
        3: "비가 오는 날씨에 두 사람은 각자 자기 보폭대로 말없이 길을 나섰습니다.",
        4: "지도를 보니 엉뚱한 길로 들어섰는데, 조셉이 뒤에서 손을 흔들며 나타났습니다.",
        5: "잠깐 길을 잃어 보고 나서야 동행이 얼마나 고마운지 알게 되었습니다.",
      },
    },
  },
  {
    base: "H01",
    kind: "B1",
    description: "섹션 2에 정보 없는 꾸밈말을 더해 길게 만듦",
    target: ["시청2-2"],
    change: {
      replace: {
        2: "교육부는 2027학년도 수능이 끝난 뒤 이어서 치러지는 각 대학의 논술과 면접 시험에, 수능과 같은 수준의 매우 엄격하고 철저한 부정행위 관리와 꼼꼼한 감독을 각별히 주문했습니다.",
      },
    },
  },
  {
    base: "H04",
    kind: "B2",
    description: "새 사실 없이 '충격적이게도', '놀라울 만큼 엄청나게' 같은 말만 더함",
    target: ["활동3"],
    change: {
      replace: {
        1: "충격적이게도 일본을 제치고 아시아에서 가장 주목받는 여행지로 떠오른 나라가 한국이라고요.",
        3: "단순한 숫자 증가를 넘어 서울의 골목이나 지역의 음식, 뷰티와 의료 같은 일상 체험으로 여행의 범위가 놀라울 만큼 엄청나게 넓어지고 있습니다.",
      },
    },
  },
];

function apply(base: Script, id: string, change: Change): Script {
  if ("order" in change) {
    const sections = change.order.map((from, index) => ({ ...base.sections[from - 1]!, order: index + 1 }));
    return { ...base, id, sections };
  }
  const sections = base.sections.map((section) => {
    const text = change.replace[section.order];
    if (!text) return section;
    // 쇼더스가 보여 준 섹션 초와 같은 말 속도로 새 글의 초를 어림한다
    const seconds = Math.round(((section.seconds * countSpokenSyllables(text)) / countSpokenSyllables(section.narration)) * 10) / 10;
    return { ...section, narration: text, seconds };
  });
  return { ...base, id, sections };
}

const holdout = process.argv[2] === "holdout";
const list = holdout ? HOLDOUT_VARIANTS : VARIANTS;
const baseDir = join("data", holdout ? "holdout" : "scripts");
const out = join("data", holdout ? "holdout-variants" : "variants");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const manifest: VariantSpec[] = [];
const seen = new Set<string>();
for (const variant of list) {
  const base = await loadScript(join(baseDir, `${variant.base}.json`));
  const id = `${variant.base}-${variant.kind}`;
  if (seen.has(id)) throw new Error(`같은 ID가 두 번 나와요: ${id}`);
  seen.add(id);
  const group = GROUPS[variant.kind[0]!]!;
  const script = apply(base, id, variant.change);
  const source = { type: base.source?.type ?? "변형", note: `${variant.base}의 변형(${group}): ${variant.description}` };
  writeFileSync(join(out, `${id}.json`), `${JSON.stringify({ ...script, source }, null, 2)}\n`, "utf8");
  manifest.push({ id, base: variant.base, kind: variant.kind, group, name: NAMES[variant.kind]!, description: variant.description, target: variant.target });
}
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const count = (group: VariantGroup) => manifest.filter((spec) => spec.group === group).length;
console.log(`${manifest.length}개를 ${out}에 썼어요: 결함 ${count("결함")} · 개선 ${count("개선")} · 대조 ${count("대조")} · 편향 ${count("편향")}`);
