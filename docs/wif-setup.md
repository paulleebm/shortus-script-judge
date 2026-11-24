# Workload Identity Federation 설정

API 키 없이 판정기를 돌리기 위한 설정이다. 이 PC에서 Google Cloud 서비스 계정의 신원 토큰(JWT)을 받아, Anthropic이 그 토큰을 짧게 쓰는 접근 토큰으로 바꿔 준다.

필요한 것:
- Anthropic 조직의 admin 또는 owner 권한
- 조직에 남은 크레딧(API 사용료는 조직에 청구된다)
- `gcloud`에 로그인된 Google 계정과, 서비스 계정을 만들 Google Cloud 프로젝트

## 1. Google Cloud: 서비스 계정 만들기

PowerShell에서 실행한다. `PROJECT_ID`와 `MY_GOOGLE_ACCOUNT`는 바꿔 넣는다.

```powershell
$PROJECT = "PROJECT_ID"
$SA = "shortus-judge@$PROJECT.iam.gserviceaccount.com"
gcloud services enable iamcredentials.googleapis.com --project $PROJECT
gcloud iam service-accounts create shortus-judge --project $PROJECT --display-name "ShortUs judge"
gcloud iam service-accounts add-iam-policy-binding $SA --project $PROJECT --member "user:MY_GOOGLE_ACCOUNT" --role "roles/iam.serviceAccountTokenCreator"
```

규칙에 넣을 서비스 계정 고유 ID를 확인한다.

```powershell
gcloud iam service-accounts describe $SA --project $PROJECT --format "value(uniqueId)"
```

토큰이 나오는지 확인한다(권한이 퍼지는 데 1~2분 걸릴 수 있다).

```powershell
gcloud auth print-identity-token --impersonate-service-account $SA --audiences "https://api.anthropic.com" --include-email
```

## 2. Claude Console: 연결 만들기

[Workload identity](https://platform.claude.com/settings/workload-identity-federation) → **Connect workload** → **Google Cloud**

| 항목 | 값 |
|---|---|
| Issuer URL | `https://accounts.google.com` (JWKS는 discovery) |
| Audience | `https://api.anthropic.com` |
| Claims: `sub` | 1단계의 고유 ID(숫자). `subject_prefix`에 `*`를 쓰지 않는다 |
| Claims: `email` | `shortus-judge@PROJECT_ID.iam.gserviceaccount.com` |
| Scope | `workspace:developer` |
| Token lifetime | 600초(마법사 기본값) |

만든 뒤 적어 둘 것: 규칙 ID(`fdrl_...`), 서비스 계정 ID(`svac_...`), 조직 ID([Organization](https://platform.claude.com/settings/organization) 화면), 규칙이 워크스페이스를 둘 이상 덮으면 워크스페이스 ID(`wrkspc_...`).

## 3. 이 저장소: .env.local 채우기

`.env.example`을 `.env.local`로 복사하고 2단계의 ID와 1단계의 서비스 계정 주소를 넣는다. `.env.local`은 `.gitignore`에 들어 있다.

## 4. 확인과 실행

```bash
npm run auth:check
```

모델 목록 조회라 요금이 들지 않는다. 실패하면 Console의 Workload identity → 인증 기록(history)에서 거절 이유를 본다. 흔한 원인은 `email` 클레임이 빠진 경우(`--include-email` 누락)와 `sub` 불일치다.

```bash
npm run judge -- data/scripts/S00.json --record
```

이 명령부터 요금이 든다. 호출 5번이다.
