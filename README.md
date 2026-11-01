# agrune (레거시)

2026-09-18까지 만든 agrune 이전 구현을 한곳에 모은 보관용 저장소입니다. 더는 고치지 않습니다.
agrune은 2026-11-01부터 처음부터 다시 설계하고 있습니다.

| 폴더 | 원래 저장소 | 내용 |
|---|---|---|
| `core/` | agrune/agrune | Playwright 위에서 도는 CLI와 작업 폴더별 백그라운드 데몬, manifest 계약과 드리프트 복구 |
| `studio/` | agrune/agrune-studio | 시나리오를 실행하고 일시정지·개입하는 Electron 데스크톱 앱 |
| `demo/` | agrune/demo | 칸반·위자드·워크플로 편집기 데모 앱과 manifest |

세 저장소의 원래 커밋은 모두 이 저장소 이력에 그대로 들어 있습니다. 이 저장소는 `agrune/agrune`을 옮겨 온 것이라 태그(v0.5까지)도 그대로입니다.
