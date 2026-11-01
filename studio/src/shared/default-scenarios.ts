import type { Scenario } from '../scenario';

export const DEMO_URL = 'http://127.0.0.1:4178';

const DEMO_MANIFEST = {
  schemaVersion: 3 as const,
  origin: DEMO_URL,
};

const NAVER_SEARCH_FALLBACK = {
  by: 'role' as const,
  role: 'combobox',
  name: '검색어를 입력해 주세요',
  exact: false,
};

/**
 * Read-only starter documents. They make Studio useful before a workspace has
 * persisted any scenarios, but are never written into the demo repository
 * until the user explicitly saves a draft.
 */
export const DEFAULT_SCENARIOS: Scenario[] = [
  {
    schema: 'agrune.scenario/v1',
    id: 'manifest-health',
    name: 'Manifest health check',
    description: 'Verify that the app exposes a usable manifest and that member search remains operable.',
    tags: ['smoke', 'manifest'],
    manifest: DEMO_MANIFEST,
    url: DEMO_URL,
    steps: [
      { id: 'health-board', assert: 'targetVisible', label: 'Board navigation is available', ref: 'nav_board_tab' },
      { id: 'health-members', do: 'click', label: 'Open members', ref: 'nav_members_tab' },
      {
        id: 'health-search-ready',
        assert: 'targetVisible',
        label: 'Member search is available',
        ref: 'member_search_input',
      },
      {
        id: 'health-search',
        do: 'fill',
        label: 'Search for Alice',
        ref: 'member_search_input',
        value: 'Alice Chen',
      },
      { id: 'health-result', assert: 'textPresent', label: 'Filtered member is visible', value: 'Alice Chen' },
    ],
  },
  {
    schema: 'agrune.scenario/v1',
    id: 'task-entry',
    name: 'Task entry path',
    description: 'Exercise the first task creation step without mutating the board.',
    tags: ['critical', 'form'],
    manifest: DEMO_MANIFEST,
    url: DEMO_URL,
    steps: [
      { id: 'task-board', do: 'click', label: 'Reset to board', ref: 'nav_board_tab' },
      { id: 'task-new', do: 'click', label: 'Open new task wizard', ref: 'board_new_task_button' },
      { id: 'task-title-ready', assert: 'targetVisible', label: 'Title field is available', ref: 'wizard_title_input' },
      {
        id: 'task-title',
        do: 'fill',
        label: 'Enter regression title',
        ref: 'wizard_title_input',
        value: 'Regression guardrail check',
      },
      { id: 'task-next-ready', assert: 'targetVisible', label: 'Next action is available', ref: 'wizard_next_button' },
      { id: 'task-close', do: 'click', label: 'Close task wizard', ref: 'wizard_close_button' },
    ],
  },
  {
    schema: 'agrune.scenario/v1',
    id: 'navigation-sweep',
    name: 'Workspace navigation sweep',
    description: 'Traverse the high-level work areas and verify that their manifest routes stay resolvable.',
    tags: ['navigation', 'regression'],
    manifest: DEMO_MANIFEST,
    url: DEMO_URL,
    steps: [
      { id: 'nav-docs', do: 'click', label: 'Open documents', ref: 'nav_docs_tab' },
      { id: 'nav-doc-ready', assert: 'targetVisible', label: 'Document controls are available', ref: 'doc_refresh_button' },
      { id: 'nav-workflow', do: 'click', label: 'Open workflow', ref: 'nav_workflow_tab' },
      { id: 'nav-canvas-ready', assert: 'targetVisible', label: 'Workflow canvas is available', ref: 'workflow_canvas_pane' },
      { id: 'nav-messenger', do: 'click', label: 'Open messenger', ref: 'nav_messenger_tab' },
      {
        id: 'nav-conversation',
        do: 'click',
        label: 'Open Alice conversation',
        ref: 'messenger_conversations[key=member-1].messenger_conversation',
      },
      { id: 'nav-message-ready', assert: 'targetVisible', label: 'Message input is available', ref: 'messenger_input' },
    ],
  },
  {
    schema: 'agrune.scenario/v1',
    id: 'naver-weather-search',
    name: 'Naver weather search',
    description: 'Search Naver for Seoul weather and verify the resulting weather page.',
    tags: ['search', 'weather'],
    manifest: { schemaVersion: 3 },
    url: 'https://www.naver.com',
    steps: [
      {
        id: 'naver-search-ready',
        do: 'waitFor',
        label: 'Search input is ready',
        ref: 'naver_search_input',
        state: 'visible',
        playwrightFallback: NAVER_SEARCH_FALLBACK,
      },
      {
        id: 'naver-search-fill',
        do: 'fill',
        label: 'Enter Seoul weather',
        ref: 'naver_search_input',
        value: '서울 날씨',
        playwrightFallback: NAVER_SEARCH_FALLBACK,
      },
      {
        id: 'naver-search-submit',
        do: 'press',
        label: 'Submit weather search',
        ref: 'naver_search_input',
        key: 'Enter',
        playwrightFallback: NAVER_SEARCH_FALLBACK,
      },
      {
        id: 'naver-search-url',
        assert: 'urlContains',
        label: 'Search results are open',
        value: 'search.naver.com/search.naver',
      },
      {
        id: 'naver-search-title',
        assert: 'titleContains',
        label: 'Search title contains Seoul weather',
        value: '서울 날씨',
      },
      {
        id: 'naver-search-weather',
        assert: 'textPresent',
        label: 'Today weather section is visible',
        value: '오늘의 날씨',
      },
    ],
  },
];
