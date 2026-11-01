# agrune-demo

`agrune` 브라우저 자동화 프레임워크의 기능을 검증하기 위한 데모 웹 애플리케이션이다. 프로젝트 관리 도구(Project Manager)를 모방한 React SPA로, 칸반 보드 / 팀 멤버 관리 / 문서 뷰어 / 워크플로우 편집기 등 실제 서비스에서 볼 수 있는 다양한 UI 패턴을 포함하고 있다. 자동화 대상은 앱이 `manifest.json`을 import해 `window.__agrune_manifest__`로 노출하는 page-owned manifest 방식으로 제공된다.

## 기술 스택

| 분류 | 기술 | 버전 |
|------|------|------|
| 런타임 | React | 19 |
| 빌드 도구 | Vite | 7 |
| 언어 | TypeScript | 5.9 |
| 스타일링 | Tailwind CSS | 4 (Vite 플러그인) |
| UI 컴포넌트 | Radix UI (Dialog, Select, Tabs, Label, Separator, Progress) | - |
| 그래프 UI | @xyflow/react | - |
| 유틸리티 | class-variance-authority, clsx, tailwind-merge, lucide-react | - |
| 린터 | ESLint 9 (flat config) + typescript-eslint + react-hooks + react-refresh | - |
| 패키지 매니저 | pnpm | - |

## 사전 요구 사항

- **Node.js** 18 이상
- **pnpm** (권장, `pnpm-lock.yaml` 기반)

## 설치 및 실행

```bash
# 의존성 설치
pnpm install

# 개발 서버 실행 (기본: http://localhost:5173)
pnpm dev
```

### Agrune manifest 사용

```bash
# demo 앱 실행 후 Agrune/Quick Mode에서 http://localhost:5173 페이지를 연다.
pnpm dev
```

앱 시작 시 `src/main.tsx`가 `manifest.json`을 `window.__agrune_manifest__`에 등록하고 Quick Mode 런타임에 reload를 요청한다. 별도 `mcp` subcommand나 manifest-load CLI를 사용하지 않는다. target 확인과 시나리오 실행은 `browser_open_tab`, `browser_get_targets`, `browser_click`, `browser_fill`, `browser_wait_for` 같은 Agrune `browser_*` MCP tools로 현재 페이지 DOM을 관찰하며 수행한다.

태스크 상세 다이얼로그, 새 태스크 위저드, select option처럼 상호작용 뒤에 생기는 target은 해당 UI를 연 상태에서 snapshot/실행 흐름으로 확인한다.

## 스크립트

| 명령어 | 설명 |
|--------|------|
| `pnpm dev` | Vite 개발 서버 실행 |
| `pnpm build` | TypeScript 타입 체크 후 프로덕션 빌드 (`dist/` 생성) |
| `pnpm typecheck` | TypeScript 타입 체크만 실행 (`tsc -b`) |
| `pnpm lint` | ESLint 실행 |
| `pnpm preview` | 빌드 결과물을 로컬에서 프리뷰 |

## 프로젝트 구조

```
agrune-demo/
├── index.html                     # 앱 엔트리 HTML
├── manifest.json                   # page-owned Agrune manifest
├── vite.config.ts                 # Vite 설정 (React SWC, Tailwind)
├── tsconfig.json                  # TypeScript 프로젝트 레퍼런스
├── tsconfig.app.json              # 앱 소스 TypeScript 설정
├── tsconfig.node.json             # Node (Vite 설정) TypeScript 설정
├── eslint.config.js               # ESLint flat config
├── package.json
├── pnpm-lock.yaml
├── public/
│   ├── vite.svg                   # 파비콘
│   └── docs/                      # iframe으로 로드되는 정적 HTML 문서
│       ├── project-overview.html
│       ├── api-reference.html
│       ├── getting-started.html
│       └── meeting-notes.html
└── src/
    ├── main.tsx                   # React 엔트리포인트
    ├── App.tsx                    # 루트 컴포넌트 (탭 네비게이션, 상태 관리)
    ├── types.ts                   # Task, Member 등 타입 및 상수 정의
    ├── seed-data.ts               # 시드 데이터 (8개 태스크, 22명 멤버)
    ├── index.css                  # Tailwind CSS + shadcn/ui 테마 변수 (라이트/다크)
    ├── lib/
    │   └── utils.ts               # cn() 유틸리티 (clsx + tailwind-merge)
    ├── hooks/
    │   └── useLocalStorage.ts     # localStorage 기반 상태 영속화 훅
    └── components/
        ├── ui/                    # shadcn/ui 기반 공통 UI 컴포넌트
        │   ├── badge.tsx
        │   ├── badge-variants.ts
        │   ├── button.tsx
        │   ├── button-variants.ts
        │   ├── card.tsx
        │   ├── dialog.tsx
        │   ├── input.tsx
        │   ├── label.tsx
        │   ├── progress.tsx
        │   ├── select.tsx
        │   ├── separator.tsx
        │   ├── table.tsx
        │   ├── tabs.tsx
        │   └── textarea.tsx
        └── features/              # 기능별 컴포넌트
            ├── KanbanBoard.tsx    # 칸반 보드 (드래그 앤 드롭)
            ├── TaskWizard.tsx     # 새 태스크 생성 마법사 (3단계)
            ├── TaskDetailDialog.tsx # 태스크 상세 보기/편집 다이얼로그
            ├── MemberTable.tsx    # 팀 멤버 테이블 (검색, 필터, 페이지네이션)
            ├── DocumentViewer.tsx # 문서 뷰어 (iframe 기반)
            ├── WorkflowEditor.tsx # React Flow 기반 워크플로우 편집기
            └── workflow/
                ├── StageNode.tsx  # 워크플로우 stage node
                └── TaskNode.tsx   # 워크플로우 task node
```

## 주요 기능

### 1. 칸반 보드 (Board 탭)

- **4개 컬럼**: To Do, In Progress, In Review, Done
- **드래그 앤 드롭**: 태스크 카드를 컬럼 간 또는 컬럼 내에서 드래그하여 상태 변경 및 순서 재정렬
- **태스크 카드**: 제목, 설명, 우선순위(low/medium/high), 담당자 표시
- **태스크 삭제**: 카드 호버 시 삭제 버튼 노출
- **태스크 상세 보기**: 카드 더블클릭 시 상세 다이얼로그 열림 (모든 필드 편집 가능)

### 2. 새 태스크 생성 마법사 (Task Wizard)

3단계 위저드 형태의 태스크 생성 플로우:

1. **기본 정보**: 태스크 이름(필수), 상태, 우선순위, 담당자(필수)
2. **상세 설정**: 설명(필수), 마감일, 예상 시간, 태그 선택 (bug, feature, enhancement 등 8종)
3. **확인/검토**: 입력 내용 최종 검토 후 생성

각 단계에는 유효성 검사가 적용되며, 진행 바와 단계 인디케이터로 현재 위치를 표시한다.

### 3. 팀 멤버 관리 (Members 탭)

- **테이블 뷰**: 이름, 이메일, 역할(admin/developer/designer/qa), 상태(active/inactive), 가입일
- **검색**: 이름 또는 이메일로 실시간 검색
- **필터**: 역할별, 상태별 필터링
- **페이지네이션**: 5/10건 단위, 페이지 번호 직접 이동
- 22명의 시드 멤버 데이터 포함

### 4. 문서 뷰어 (Docs 탭)

- **4종 문서**: Project Overview, API Reference, Getting Started, Meeting Notes
- **카드 선택기**: 카테고리별(Project/Technical/Guide/Notes) 색상 뱃지가 있는 문서 선택 카드
- **iframe 뷰어**: 선택된 HTML 문서를 iframe으로 렌더링
- **도구 모음**: 새로고침, 확장/축소, 새 탭에서 열기

### 5. 워크플로우 편집기 (Workflow 탭)

- **React Flow 캔버스**: stage node와 task node를 시각적으로 배치
- **연결 편집**: handle drag로 node 간 edge 생성, 같은 카드 쌍의 중복 연결 방지
- **연결 삭제**: edge 클릭 시 연결 삭제
- **탐색 도구**: Background, Controls, MiniMap 제공

### 6. 상태 영속화

- 모든 주요 상태(태스크 목록, 활성 탭, 검색어, 필터, 위저드 열림 상태 등)가 `localStorage`에 저장되어 새로고침 후에도 유지됨

## Agrune page-owned manifest

`manifest.json`은 보드의 티켓 카드, 태스크 상세 다이얼로그, 새 태스크 위저드, 담당자 선택 옵션을 target으로 노출한다. 앱은 manifest를 페이지 전역의 `window.__agrune_manifest__`에 등록하고, 로컬 에이전트는 현재 브라우저 페이지에서 `browser_*` tools를 통해 “가장 할 일 없는 사람에게 티켓 할당” 같은 시나리오를 수행할 수 있다.

## 빌드 및 배포

```bash
# 프로덕션 빌드
pnpm build

# 빌드 결과물 로컬 프리뷰
pnpm preview
```

빌드 결과물은 `dist/` 디렉터리에 생성된다. 정적 파일 서버(Nginx, Cloudflare Pages, Vercel 등)에 `dist/` 디렉터리를 배포하면 된다.

## 검증 포인트

- `manifest.json`이 핵심 보드/담당자 target을 제공한다.
- 앱 실행 후 `window.__agrune_manifest__`가 page-owned manifest로 등록되는지 확인한다.
- `browser_get_targets`로 현재 DOM의 target 후보를 확인하고, `browser_click`/`browser_fill`/`browser_wait_for`로 클릭, 입력, 대기 흐름을 검증한다.
- 태스크 상세 다이얼로그와 담당자 선택 옵션은 카드를 연 뒤 snapshot/실행 흐름으로 확인한다.
- 보드 드래그, 문서 iframe, Workflow canvas 상호작용을 수동 검증하기 위한 fixture로 유지한다.
