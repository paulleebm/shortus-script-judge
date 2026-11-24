/**
 * 독립 참조 판정용 꾸러미를 만든다(DECISIONS 19).
 * 판정기 답을 보지 않은 판정자(서브에이전트)가 같은 단계 기준표로 대본을 직접 판정하게 하는 안내서와 대본 모음이다.
 * 기준표와 민감 주제 정의는 판정기 프롬프트와 같은 코드에서 가져온다.
 * 실행: npx tsx scripts/make-rater-pack.ts <출력 폴더> <대본 JSON 경로...>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { anchorTable, RUBRIC_VERSION } from "../src/judge/anchors.js";
import { topicDefinitions } from "../src/judge/prompts.js";
import { cutOpening } from "../src/rules/opening.js";
import { loadScript } from "../src/script.js";

const [outDir, ...paths] = process.argv.slice(2);
if (!outDir || paths.length === 0) {
  console.error("사용법: npx tsx scripts/make-rater-pack.ts <출력 폴더> <대본 JSON 경로...>");
  process.exit(1);
}

const guide = `# 쇼츠 대본 판정 안내(기준표 ${RUBRIC_VERSION})

쇼더스가 기사나 글로 만든 30~45초 세로 영상(유튜브 쇼츠)의 대본을, 렌더하기 전에 판정한다.
목적은 이 대본으로 만든 쇼츠를 시청자가 넘기지 않고 보고(시청), 반응하고(활동), 채널에 호감을 갖게 될지(호감) 가늠하는 것이다.
영상은 화면 위에 제목을 띄우고, 섹션마다 나레이션을 읽는다.

판정하는 법
- 질문마다 아래 기준표의 설명에만 맞춰 1~5 단계를 고른다. 대본이 자극적이거나 길다는 것만으로 단계를 올리지 않는다.
- 지금 판정하는 질문만 본다. 다른 질문에 대한 인상에 끌려가지 않는다.
- 사실이 맞는지는 판정하지 않는다.
- 단계마다 이유를 한 문장으로 적는다.

## 시청

시청1. 첫 3초가 궁금증을 만드는 정도 — 제목과 '첫 3초'로 적어 둔 말만 보고 판정한다. scripts.md 앞쪽의 '시청1용' 목록에서 모든 대본의 시청1을 먼저 정하고, 그다음에 대본 전문을 읽는다. 시청자는 쇼츠를 넘기다가 첫 3초만 듣고 계속 볼지 정한다. 화면의 제목을 읽지 않고 넘기는 시청자도 많으므로, 첫 3초 동안 들리는 말 자체에 궁금증 요소가 있는지를 먼저 본다.
${anchorTable("watch1")}

시청2. 섹션이 더하는 정보가 얼마나 흥미로운가 — 섹션마다, 그 섹션이 앞 섹션들에 더하는 정보로 판정한다. 글이 길거나 꾸밈말이 많다고 정보가 늘지 않는다.
${anchorTable("watch2")}

시청3. 흥미가 자연스럽게 이어지는가 — 이웃한 섹션 사이 연결(1→2, 2→3, …)마다 판정한다.
${anchorTable("watch3")}

## 활동

활동1. 민감 주제 — 대본의 중심 내용인 것만 고른다(스치듯 언급하거나 배경으로만 나오면 고르지 않는다). 없으면 빈 목록.
${topicDefinitions("")}

활동2. 의견이 갈리는 정도 — 대본 문장이 직접 제기하는 쟁점만 센다. 대본에 서로 다른 입장이 함께 나오거나, 대본이 시청자나 사연 속 인물에게 판단·선택을 묻는 물음을 던지면 직접 제기한 것이다. 필자나 인물 한쪽의 주장·평가만 있거나, 대본을 읽고 떠올린 쟁점은 세지 않는다. 사실을 찾아보면 끝나는 문제는 생각이 갈리는 쟁점이 아니다. 사연 속 인물이 A할지 B할지 두 선택지 사이에서 고민한다고 밝힌 것도 판단을 묻는 것이다(막연히 '고민 중'이라고만 하면 아니다). 앞으로 어떻게 될지에 대한 예측은 대본이 엇갈리는 전망을 보여 주면 생각이 갈리는 쟁점으로 센다. 양쪽을 보여 준다는 것은 서로 다른 주장이나 전망을 내놓는 사람·근거가 함께 나온다는 뜻이다. 한 사람이 '반반', '알 수 없다'고 말한 것은 양쪽 제시가 아니다. 같은 다툼을 달리 말한 것은 하나로 센다.
${anchorTable("engage2")}

활동3. 감정을 건드리는 정도 — 감정 장면(분노·억울함, 놀람, 공감·연민, 불안, 웃음)과 세기, 누가 누구에게 피해를 주는 구도, 예상을 뒤집는 반전을 본다. 장면은 누가 무엇을 겪는 사건이나 상황이다. '충격', '끔찍한', '경악' 같은 꾸밈말만으로는 장면이 아니고 세기도 올리지 않는다. 숫자 대비, 의외의 통계, 속설 바로잡기처럼 정보가 의외인 것은 시청2에서 보므로 여기서 세지 않는다. 피해 구도는 피해를 입는 쪽이 그려져야 하고, 반전은 이야기 속 상황이 뒤집히는 것이다.
${anchorTable("engage3")}

정책 위험 — 혐오, 특정 집단 비하, 폭력 조장으로 넘어가는가. 민감 주제를 다루는 것만으로는 해당하지 않는다.

## 호감

호감1. 써먹을 수 있는 내용의 정도 — 시청자가 자기 생활에서 무엇을 하거나, 피하거나, 고르거나, 챙기는 데 쓸 수 있는 정보만 센다. 소식, 통계, 사연, 제도 변화 설명처럼 시청자가 그것으로 할 일이 없으면 써먹을 정보가 아니다. 대본이 알려 주는 대로 할 수 있는 일만 세고, 정보를 보고 떠올린 활용은 세지 않는다. 같은 일에 쓰이는 정보(예: 한 요리법의 여러 단계)는 하나로 센다. 순서와 방법을 따라 할 수 있으면 분량이 다 없어도 구체적이다. 숫자가 들어 있다는 것만으로는 구체적이지 않다.
${anchorTable("affinity1")}

호감2. 제목과 첫 3초가 기대하게 한 것을 채우는 정도 — 제목과 첫 3초가 시청자에게 기대하게 한 것(약속)을 한 문장으로 정하고, 대본이 그것을 얼마나 채우는지 본다.
${anchorTable("affinity2")}

## 답 형식

아래 모양의 JSON 하나로 답한다. watch2는 섹션 수만큼, watch3는 섹션 수 - 1만큼 순서대로 적는다.

\`\`\`json
{
  "rater": "판정자 이름",
  "rubric": "${RUBRIC_VERSION}",
  "labels": [
    {
      "id": "S00",
      "watch1": 3,
      "watch2": [3, 4, 2, 3],
      "watch3": [3, 2, 4],
      "topics": [],
      "engage2": 2,
      "engage3": 3,
      "affinity1": 2,
      "affinity2": 4,
      "policyRisk": false,
      "reasons": {
        "watch1": "한 문장",
        "watch2": ["섹션 1 이유", "섹션 2 이유", "섹션 3 이유", "섹션 4 이유"],
        "watch3": ["1→2 이유", "2→3 이유", "3→4 이유"],
        "engage2": "한 문장",
        "engage3": "한 문장",
        "affinity1": "한 문장",
        "affinity2": "약속: … / 채운 정도: …"
      }
    }
  ]
}
\`\`\`
`;

const scripts = await Promise.all(paths.map((path) => loadScript(path)));
const openings = scripts
  .map((script) => [`### ${script.id}`, `제목: ${script.title}`, `첫 3초: ${cutOpening(script.sections).text}`, ""].join("\n"))
  .join("\n");
const body = scripts
  .map((script) => {
    const opening = cutOpening(script.sections);
    return [
      `## ${script.id}`,
      "",
      `제목: ${script.title}`,
      `첫 3초: ${opening.text}`,
      "",
      ...script.sections.map((section) => `[섹션 ${section.order} · ${section.role} · ${section.seconds}초] ${section.narration}`),
      "",
    ].join("\n");
  })
  .join("\n");

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "guide.md"), guide, "utf8");
writeFileSync(join(outDir, "scripts.md"), `# 판정할 대본 ${scripts.length}개\n\n## 시청1용: 제목과 첫 3초\n\n${openings}\n## 대본 전문\n\n${body}`, "utf8");
console.log(`${join(outDir, "guide.md")}, ${join(outDir, "scripts.md")} (${scripts.length}개)`);
