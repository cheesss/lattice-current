# Connected System Workflow, Explained

관련 시각화:

- 상세 HTML: [CONNECTED_SYSTEM_WORKFLOW_DETAILED_2026-04-18.html](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\CONNECTED_SYSTEM_WORKFLOW_DETAILED_2026-04-18.html)
- 상세 PNG: [CONNECTED_SYSTEM_WORKFLOW_DETAILED_2026-04-18.png](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\CONNECTED_SYSTEM_WORKFLOW_DETAILED_2026-04-18.png)
- Mermaid 원본: [CONNECTED_SYSTEM_WORKFLOW_DETAILED_2026-04-18.mmd](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\CONNECTED_SYSTEM_WORKFLOW_DETAILED_2026-04-18.mmd)

이 문서는 상세 다이어그램의 각 박스와 연결을 문장으로 풀어 쓴 버전이다.  
다이어그램은 한눈에 구조를 보는 용도이고, 이 문서는 “각 박스가 실제로 무슨 일을 하는가”를 읽는 용도다.

## 전체 구조 한 줄 요약

이 시스템은:

`외부 데이터 수집 -> NAS에 정규화 저장 -> 테마/시그널/나우캐스트 계산 -> Dashboard API로 조립 -> Home / Inbox / Investigate / Geo / Ops / OpenClaw에 제공 -> 인간 승인/실행 -> 다시 자동화 경로로 환류`

구조로 돌아간다.

핵심 원칙은 두 가지다.

- `관측값`과 `추정값`을 분리한다.
- `읽기 화면`과 `실행 화면`을 분리한다.

읽기 화면은 `Home`, `Investigate`, `Geo Lens`, `Ops`, `OpenClaw Chat`이고,  
실행 화면은 주로 `Decision Inbox`다.

## 01 입력 계층

### 뉴스/피드 입력

여기는 RSS, 뉴스 사이트, OSINT 문서 같은 비정형 소스가 들어오는 곳이다.

이 입력은 보통:

- 기사 제목
- 본문
- 발행 시각
- 출처 도메인
- 태그/주제 단서

를 포함한다.

이 계층의 목적은 “세상에서 일어난 일”을 빠르게 포착하는 것이다.  
아직 정제된 상태가 아니므로, 여기서 바로 제품 화면에 올리지는 않는다.

### 시장/매크로 입력

여기는 FRED, Yahoo, 시장 시세 같은 정형 데이터가 들어오는 곳이다.

이 계층은:

- 금리
- 크레딧 스프레드
- 달러/원유
- 변동성
- 기타 매크로 시계열

의 원시 관측값 또는 준실시간 snapshot을 공급한다.

### 히스토리 입력

여기는 backfill, warm store, replay, historical validation용 데이터가 들어오는 곳이다.

이 계층은 실시간 운영면이라기보다:

- bootstrap
- replay
- walk-forward 검증
- 모델 학습용 window 구성

에 더 가깝다.

즉 “지금 무슨 일이 벌어졌나”를 직접 보여주기보다,  
“과거를 기준으로 현재 판단 체계를 보강하는 입력”이다.

### 운영자 요청

여기는 사람이 시스템에 질문하거나, 승인하거나, 재시도/수리를 지시하는 입력이다.

현재 이 입력은 크게 두 경로로 들어온다.

- 대시보드 버튼
- OpenClaw Chat / tool call

## 02 수집/인입

### 피드 수집기

뉴스/피드 입력을 실제 기사 row로 바꾸는 계층이다.

여기서 하는 일:

- 원문 fetch
- 본문/요약 파싱
- 발행 시각 정규화
- URL/도메인 정리
- article 후보 생성

결과는 주로 `articles` 쪽으로 들어간다.

### 관측 신호 리프레시

FRED 계열 observed 시계열을 NAS로 적재한다.

즉:

- 실제 관측 매크로 시리즈
- 느리지만 authoritative한 값

을 시스템 기준의 `observed` layer로 밀어 넣는 역할이다.

### 시장 시세 리프레시

market_quotes를 채우고, 필요한 경우 signal 계층으로도 일부 연결한다.

이 계층은 빠르지만 noisy할 수 있다.  
그래서 observed layer의 대체가 아니라, nowcast feature 공급원이나 snapshot 보조 데이터로 주로 쓰인다.

### 소스 자동화

여기는 `source add`, `self-heal`, `approval candidate`, `probe`가 모이는 곳이다.

즉 “새 소스를 등록할지 말지”, “기존 소스가 깨졌는지”, “사람 승인으로 올려야 하는지”를 만드는 자동화 계층이다.

이 박스 안에 실질적으로 들어가는 기능은:

- source probe
- self-heal candidates
- add-rss proposal 생성
- approval queue 승격

이다.

### 로컬 훅

sidecar, desktop runtime, local state 같은 보조 제어면이다.

핵심 역할:

- 로컬 runtime metadata 제공
- desktop/sidecar 연동
- 일부 local control plane 제공

## 03 저장/정규화

### 콘텐츠 저장소

여기에는 `articles`, `canonical events`, `source hygiene` 결과가 들어간다.

즉 뉴스 텍스트와 이벤트 정규화 결과를 담는 층이다.

핵심 목적:

- 원시 기사 축적
- 이벤트 단위로 다시 묶기
- 출처 품질/집중도 관리

### 신호 저장소

여기에는:

- `fred_observations`
- `market_quotes`
- `signal_history`

가 포함된다.

이 층이 수치 시계열의 중심이다.

여기서 제일 중요한 구조는:

- `observed`
- `proxy / composite / imputed`

같은 의미가 붙은 `signal_history`라는 점이다.

즉 숫자가 하나 보여도, 내부적으로는 값의 성격이 다를 수 있다.

### 리뷰 저장소

여기는 실행 대기와 인간 검토 상태를 저장한다.

포함되는 것:

- `approval_queue`
- `discovery_triage`
- `codex proposals`
- proposal state

즉 “시스템이 제안했지만 아직 사람 판단이 필요한 것”이 여기에 모인다.

### 추정 저장소

여기는 `observed`와 분리된 `estimated` layer다.

포함되는 것:

- `estimated_signal_nowcasts`
- `nowcast_reconciliation`
- `model_registry`

즉:

- 지금 추정한 값
- 나중에 실측과 비교한 결과
- 어떤 모델이 승인/승격됐는가

를 별도로 저장한다.

### NAS 상태면

이 프로젝트의 system of record다.

의미는 단순하다.

- 대부분의 운영 상태는 결국 여기서 읽고
- 대부분의 실행 결과도 결국 여기에 쓴다.

OpenClaw도 기본적으로 NAS에 직접 쓰는 게 아니라,  
Lattice 서비스 경로를 호출하고 그 서비스가 NAS에 쓰는 구조다.

## 04 계산/판단

### 테마/전파 계산

뉴스와 이벤트를 기반으로:

- canonical pathway
- structural signal
- theme proposal
- theme transmission

을 계산한다.

즉 텍스트/이벤트 세계를 “무슨 테마가 실제로 살아 움직이고 있는가”라는 구조로 바꾸는 계층이다.

### 스냅샷 빌더

여기는 읽기용 surface를 조립하는 계층이다.

만드는 것:

- KPI strip
- live status
- theme brief
- ops snapshot

즉 사용자가 보는 dashboard summary는 대부분 이 계층에서 만들어진다.

### 나우캐스트 계산

현재 운영에서 여기는 제한적으로만 활성화된다.

실제로 의미 있는 것:

- composite nowcast
- event-intensity nowcast
- reconcile path

`rates nowcast`는 코드 경로는 있지만 기본 운영에서는 off다.

즉 이 계층은 “관측이 늦는 값을 추정으로 보완하는 계층”이지만,  
품질이 검증된 부분만 실운영에 남겨두는 상태다.

### 모델/검증 루프

이 계층은 nowcast 모델을:

- train
- validate
- gate
- replay
- abstain

관점에서 검증한다.

핵심은 “모델이 존재한다”가 아니라 “gate를 통과했는가”다.

이 프로젝트에서는 이미:

- gate fail 모델 저장 금지
- 저장된 모델도 promotion state로 다시 필터링

라는 안전장치가 들어가 있다.

### 스케줄러/데몬

백그라운드 자동화의 심장이다.

하는 일:

- refresh task 실행
- compute task 실행
- reconcile task 실행
- automation cycle 반복

즉 수집과 계산을 “계속 돌아가게” 만드는 계층이다.

### OpenClaw 오케스트레이터

이건 제품 본체가 아니라 상위 control plane이다.

하는 일:

- tool invoke
- briefing
- webhook flow
- 운영자 질문 응답
- incident follow-up

즉 “Lattice가 상태와 근거의 본체”라면,  
“OpenClaw는 채널/에이전트/운영 orchestration 층”이다.

## 05 서빙/API

### Dashboard API

대시보드와 운영면이 읽는 거의 모든 값은 여기서 나온다.

역할:

- NAS 상태 읽기
- observed/estimated fuse
- queue payload 제공
- theme brief 응답 생성
- ops snapshot 응답 생성

즉 실제 제품 surface의 대부분은 이 API를 통해 구성된다.

### OpenClaw 도구면

같은 API를 tool-call 표면으로 재노출한 층이다.

즉 OpenClaw는 별도의 독립 DB를 읽는 게 아니라,

- `get_health`
- `get_kpi_summary`
- `get_approval_queue`
- `get_theme_brief`

같은 도구를 통해 같은 시스템 상태를 읽는다.

## 06 사용자 표면

### Home

읽기 시작점이다.

여기서 사용자는:

- KPI strip
- digest
- actionable signal

을 보고 어디로 들어갈지 결정한다.

Home은 “판단을 시작하는 요약 화면”이지,  
실제 실행은 대체로 여기서 하지 않는다.

### Decision Inbox

실행 중심 화면이다.

여기서 하는 일:

- proposal review
- approval review
- discovery triage
- simulate
- accept/reject
- canonical/watch/suppress

즉 시스템의 쓰기/결정 흐름은 대부분 여기서 발생한다.

### Investigate

근거를 읽는 화면이다.

여기서 사용자는:

- Theme Brief
- evidence
- citations
- watchpoints

를 읽고, 그 뒤 Inbox로 돌아가 결정을 내리는 경우가 많다.

즉 “읽는 곳”이지 “실행하는 곳”은 아니다.

### Geo Lens

공간 맥락을 주는 보조 화면이다.

테마나 이벤트를:

- 어느 지역에서 보고 있는지
- 어떤 지리적 힌트가 있는지

판단할 때 쓰인다.

### Ops

운영 신뢰도를 보는 화면이다.

여기서 보는 것:

- freshness
- runtime health
- source ops
- automation issue

즉 “이 값이 믿을 만한가”와 “자동화가 잘 돌고 있는가”를 확인하는 면이다.

### OpenClaw Chat

읽기/운영 질문의 대화형 표면이다.

예를 들면:

- 지금 상태 브리핑
- approval queue 요약
- freshness 위험 설명
- 어떤 항목이 막혔는지

를 물어볼 수 있다.

## 07 클릭/리뷰/실행 루프

### ① 인박스 열기

Home에서 실행 화면으로 넘어가는 단계다.

즉 “읽기 요약 -> 실행 면” 전환이다.

### ② 미리보기 후 결정

Decision Inbox에서 실제로 액션을 누르는 단계다.

여기서 proposal/approval/triage가 각각:

- accept
- reject
- simulate
- canonical
- watch
- suppress

같은 결정으로 이어진다.

### ③ 풀 브리프 열기

Theme chip이나 Open full brief를 눌러 Investigate로 들어가는 단계다.

즉 “바로 결정하지 않고, 근거를 더 읽는 루프”다.

### ④ Geo/Ops 확인

근거는 맞는데:

- 공간 맥락이 애매하거나
- freshness가 불안하거나
- source 상태가 안 좋을 때

Geo Lens나 Ops를 추가로 보는 단계다.

### ⑤ OpenClaw 질의

사람이 시스템에게 “현재 상태를 설명해 달라”고 묻는 단계다.

이 루프는 클릭보다 질문 중심이고,
운영 브리핑이나 incident follow-up에 가깝다.

### 인간 리뷰

시스템이 제안한 것을 최종적으로 사람이 해석하는 단계다.

핵심은:

- 자동화가 제안은 할 수 있어도
- 의미 있는 승격/거절/채택은 여전히 인간 판단이 묶여 있다는 점이다.

### 실행/수리

리뷰 결과가 실제 시스템 상태를 바꾸는 단계다.

예:

- proposal executor 실행
- source repair
- queue state update
- approval note 반영

### 후속조치

질문이나 운영 판단이 끝난 뒤:

- retry
- rerun
- incident follow-up
- 더 깊은 조사

를 다시 시스템에 넣는 단계다.

즉 이 시스템은 일방향이 아니라 루프형이다.

## 소스 추가는 어디에 들어가나

소스 추가는 대체로 다음 경로를 탄다.

`소스 자동화 -> 리뷰 저장소 -> Decision Inbox -> 인간 리뷰 -> 실행/수리 -> 다시 소스 자동화`

즉 처음에는 자동 제안이고,  
중간에는 사람이 승인하고,  
마지막에 executor/probe/repair가 상태를 반영한다.

## 키워드/테마 추가는 어디에 들어가나

키워드/테마 추가는 대체로 다음 경로를 탄다.

`콘텐츠 저장소 -> 테마/전파 계산 -> 스냅샷 빌더 -> Home/Investigate -> 인간 리뷰`

즉 먼저 자동으로 theme 후보나 keyword candidate가 만들어지고,  
그다음 사람은 Investigate와 Inbox를 오가며 그 의미를 판단한다.

## observed 와 estimated는 왜 구분하나

이 프로젝트는 이 구분이 핵심이다.

- `observed`
  - 실제 관측이나 authoritative source에서 들어온 값
- `estimated`
  - nowcast나 composite 추정값

이 둘을 섞으면:

- stale/backfill/fallback와 구분이 무너지고
- 운영 판단이 흐려지고
- 화면 전체 신뢰가 떨어진다.

그래서 저장소도 분리했고,
API도 메타를 붙여서,
UI도 trust chip으로 구분하려는 방향으로 가고 있다.

## 지금 운영에서 실제로 중요한 것

현재 운영 기준으로는:

- `composite nowcasts`
- `event-intensity nowcast`
- `reconcile-nowcasts`

가 주력이다.

반면:

- `rates nowcast`

는 코드와 설계는 있지만, 기본 운영에서는 꺼져 있다.

즉 이 시스템은 “모든 계산을 다 돌리는 상태”가 아니라,
“신뢰 가능한 경로만 남겨서 운영하는 상태”다.
