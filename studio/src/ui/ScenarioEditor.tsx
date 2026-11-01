import {
  ArrowDown,
  ArrowUp,
  Braces,
  Check,
  Code2,
  FileJson2,
  Play,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import { cloneElement, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode, type RefObject } from 'react';
import {
  SCENARIO_STEP_CATALOG,
  collectScenarioDependencies,
  getStepKind,
  validateScenario,
  type PlaywrightFallbackLocator,
  type Scenario,
  type ScenarioStep,
  type ScenarioValidationIssue,
} from '../scenario';
import './scenario-editor.css';

export interface ScenarioEditorProps {
  open: boolean;
  scenario: Scenario;
  targetRefs?: string[];
  initialStepIndex?: number;
  initialFocusTarget?: boolean;
  saving?: boolean;
  running?: boolean;
  runBlockedReason?: string;
  onClose: () => void;
  onSave: (scenario: Scenario) => void | Promise<void>;
  onRun: (scenario: Scenario) => void | Promise<void>;
}

type EditorMode = 'form' | 'json';
type EditorAction = 'save' | 'run';

interface PendingStepKindChange {
  index: number;
  fromToken: string;
  toToken: string;
}

let generatedStepId = 0;

function cloneScenario(value: Scenario): Scenario {
  return structuredClone(value);
}

function nextStepId(): string {
  generatedStepId += 1;
  return `step-${Date.now().toString(36)}-${generatedStepId}`;
}

function stepToken(step: ScenarioStep): string {
  return 'do' in step ? `action:${step.do}` : `assertion:${step.assert}`;
}

function formatScenario(value: Scenario): string {
  return JSON.stringify(value, null, 2);
}

/** Shared with focused tests so dirty-state behavior cannot silently regress. */
export function scenarioEditorHasChanges(
  initial: Scenario,
  draft: Scenario,
  mode: EditorMode,
  jsonText: string,
): boolean {
  if (mode === 'json') return jsonText !== formatScenario(initial);
  return JSON.stringify(draft) !== JSON.stringify(initial);
}

function isConfiguredStepValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** A kind change is destructive when it would drop anything beyond id/label and the verb itself. */
export function stepKindChangeNeedsConfirmation(step: ScenarioStep, nextToken: string): boolean {
  if (stepToken(step) === nextToken) return false;
  return Object.entries(step as unknown as Record<string, unknown>).some(([key, value]) => (
    !['id', 'label', 'do', 'assert'].includes(key) && isConfiguredStepValue(value)
  ));
}

function stepKindLabel(token: string): string {
  const [, kind] = token.split(':');
  return SCENARIO_STEP_CATALOG.find((item) => item.kind === kind)?.label ?? kind ?? token;
}

function newStep(token = 'action:click'): ScenarioStep {
  const [family, kind] = token.split(':') as ['action' | 'assertion', string];
  const id = nextStepId();
  if (family === 'action') {
    switch (kind) {
      case 'navigate': return { id, do: 'navigate', url: '/' };
      case 'fill': return { id, do: 'fill', ref: '', value: '' };
      case 'type': return { id, do: 'type', ref: '', text: '' };
      case 'press': return { id, do: 'press', key: 'Enter' };
      case 'select': return { id, do: 'select', ref: '', value: '' };
      case 'check': return { id, do: 'check', ref: '' };
      case 'uncheck': return { id, do: 'uncheck', ref: '' };
      case 'wait': return { id, do: 'wait', ms: 500 };
      case 'waitFor': return { id, do: 'waitFor', ref: '', state: 'visible', timeoutMs: 10_000 };
      case 'dblclick': return { id, do: 'dblclick', ref: '' };
      case 'contextmenu': return { id, do: 'contextmenu', ref: '' };
      case 'hover': return { id, do: 'hover', ref: '' };
      case 'longpress': return { id, do: 'longpress', ref: '' };
      default: return { id, do: 'click', ref: '' };
    }
  }
  switch (kind) {
    case 'urlEquals': return { id, assert: 'urlEquals', value: '' };
    case 'titleContains': return { id, assert: 'titleContains', value: '' };
    case 'textPresent': return { id, assert: 'textPresent', value: '' };
    case 'textAbsent': return { id, assert: 'textAbsent', value: '' };
    case 'targetVisible': return { id, assert: 'targetVisible', ref: '' };
    case 'targetHidden': return { id, assert: 'targetHidden', ref: '' };
    case 'targetEnabled': return { id, assert: 'targetEnabled', ref: '' };
    case 'targetDisabled': return { id, assert: 'targetDisabled', ref: '' };
    case 'targetCount': return { id, assert: 'targetCount', repeat: '', count: 1 };
    case 'noConsoleErrors': return { id, assert: 'noConsoleErrors' };
    case 'networkStatus': return { id, assert: 'networkStatus', urlContains: '/api/', status: 200 };
    default: return { id, assert: 'urlContains', value: '' };
  }
}

function errorSummary(issues: ScenarioValidationIssue[]): string {
  if (!issues.length) return '';
  return issues.map((issue) => `${issue.path || 'scenario'}: ${issue.message}`).join('\n');
}

function stepTitle(step: ScenarioStep): string {
  const descriptor = SCENARIO_STEP_CATALOG.find((item) => item.kind === getStepKind(step));
  return step.label || descriptor?.label || getStepKind(step);
}

function stepDetail(step: ScenarioStep): string {
  const record = step as unknown as Record<string, unknown>;
  for (const key of ['ref', 'url', 'value', 'text', 'key', 'repeat', 'urlContains']) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  if ('do' in step && step.do === 'wait' && typeof step.ms === 'number') return `${step.ms} ms`;
  return 'Configure this step';
}

function moveEditorTabFocus(event: ReactKeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
  if (!tabs.length) return;
  const current = Math.max(0, tabs.indexOf(event.currentTarget));
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}

export function ScenarioEditor({
  open,
  scenario,
  targetRefs = [],
  initialStepIndex = 0,
  initialFocusTarget = false,
  saving = false,
  running = false,
  runBlockedReason,
  onClose,
  onSave,
  onRun,
}: ScenarioEditorProps): JSX.Element | null {
  const [initialDraft, setInitialDraft] = useState<Scenario>(() => cloneScenario(scenario));
  const [draft, setDraft] = useState<Scenario>(() => cloneScenario(scenario));
  const [selectedIndex, setSelectedIndex] = useState(initialStepIndex);
  const [mode, setMode] = useState<EditorMode>('form');
  const [jsonText, setJsonText] = useState(() => formatScenario(scenario));
  const [tagsText, setTagsText] = useState(() => (scenario.tags ?? []).join(', '));
  const [jsonError, setJsonError] = useState('');
  const [jsonUnvalidated, setJsonUnvalidated] = useState(false);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const [pendingStepKind, setPendingStepKind] = useState<PendingStepKindChange | null>(null);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(null);
  const [activeAction, setActiveAction] = useState<EditorAction | null>(null);
  const [actionError, setActionError] = useState('');
  const initialFocusRef = useRef<HTMLInputElement>(null);
  const targetFocusRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLFieldSetElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const discardCancelRef = useRef<HTMLButtonElement>(null);
  const stepTypeRef = useRef<HTMLSelectElement>(null);
  const stepTypeCancelRef = useRef<HTMLButtonElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const addStepButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const next = cloneScenario(scenario);
    setInitialDraft(cloneScenario(next));
    setDraft(next);
    setJsonText(formatScenario(next));
    setTagsText((next.tags ?? []).join(', '));
    setJsonError('');
    setJsonUnvalidated(false);
    setMode('form');
    setShowAllIssues(false);
    setDiscardConfirmationOpen(false);
    setPendingStepKind(null);
    setPendingDeleteIndex(null);
    setActiveAction(null);
    setActionError('');
    setSelectedIndex(Math.max(0, Math.min(initialStepIndex, Math.max(0, next.steps.length - 1))));
  }, [initialStepIndex, open, scenario]);

  const validation = useMemo(() => validateScenario(draft), [draft]);
  const issues = validation.ok ? [] : validation.errors;
  const selectedStep = draft.steps[selectedIndex];
  const targetOptions = useMemo(() => [...new Set(targetRefs)].sort(), [targetRefs]);
  const isDirty = useMemo(
    () => scenarioEditorHasChanges(initialDraft, draft, mode, jsonText),
    [draft, initialDraft, jsonText, mode],
  );
  const isSaving = saving || activeAction === 'save';
  const isRunning = running || activeAction === 'run';
  const busy = isSaving || isRunning;
  const jsonNeedsValidation = mode === 'json' && jsonUnvalidated && !jsonError;
  const visibleIssues = jsonNeedsValidation || jsonError ? [] : issues;
  const secretRunBlockedReason = collectScenarioDependencies(draft).secretRefs.length
    ? 'Secret vault execution is not connected. You can save this scenario, but it cannot run in Studio yet.'
    : undefined;
  const effectiveRunBlockedReason = runBlockedReason ?? secretRunBlockedReason;
  const footerProblem = Boolean(actionError || jsonError || jsonNeedsValidation || visibleIssues.length > 0 || effectiveRunBlockedReason);
  const footerText = actionError
    || (jsonError
      ? 'JSON needs attention'
      : jsonNeedsValidation
        ? 'Unvalidated changes'
        : visibleIssues.length
          ? `${visibleIssues.length} validation issue${visibleIssues.length === 1 ? '' : 's'}`
          : effectiveRunBlockedReason ?? 'Scenario is valid');

  const requestClose = useCallback((): void => {
    if (busy) return;
    if (isDirty) {
      setPendingStepKind(null);
      setPendingDeleteIndex(null);
      setShowAllIssues(false);
      setDiscardConfirmationOpen(true);
      return;
    }
    onClose();
  }, [busy, isDirty, onClose]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      const target = initialFocusTarget ? targetFocusRef.current : initialFocusRef.current;
      (target ?? initialFocusRef.current)?.focus();
      target?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [initialFocusTarget, open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocusRef.current = previous;
    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) window.requestAnimationFrame(() => target.focus());
    };
  }, [open]);

  useEffect(() => {
    if (discardConfirmationOpen) discardCancelRef.current?.focus();
  }, [discardConfirmationOpen]);

  useEffect(() => {
    if (pendingStepKind) stepTypeCancelRef.current?.focus();
  }, [pendingStepKind]);

  useEffect(() => {
    if (pendingDeleteIndex !== null) deleteCancelRef.current?.focus();
  }, [pendingDeleteIndex]);

  useEffect(() => {
    if (!open) return;
    function handleDialogKeys(event: KeyboardEvent): void {
      if (event.key === 'Tab') {
        const focusRoot = discardConfirmationOpen
          ? sheetRef.current?.querySelector<HTMLElement>('[role="alertdialog"]')
          : sheetRef.current;
        const focusable = Array.from(focusRoot?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? []);
        if (!focusable.length) {
          event.preventDefault();
          return;
        }
        const first = focusable[0]!;
        const last = focusable.at(-1)!;
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !focusRoot?.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (busy) return;
      if (pendingStepKind) {
        setPendingStepKind(null);
        window.requestAnimationFrame(() => stepTypeRef.current?.focus());
        return;
      }
      if (pendingDeleteIndex !== null) {
        setPendingDeleteIndex(null);
        window.requestAnimationFrame(() => deleteButtonRef.current?.focus());
        return;
      }
      if (discardConfirmationOpen) {
        setDiscardConfirmationOpen(false);
        window.requestAnimationFrame(() => closeButtonRef.current?.focus());
        return;
      }
      requestClose();
    }
    document.addEventListener('keydown', handleDialogKeys);
    return () => document.removeEventListener('keydown', handleDialogKeys);
  }, [busy, discardConfirmationOpen, open, pendingDeleteIndex, pendingStepKind, requestClose]);

  if (!open) return null;

  function resumeEditing(): void {
    setDiscardConfirmationOpen(false);
    setPendingDeleteIndex(null);
    setActionError('');
  }

  function setScenarioField<K extends keyof Scenario>(key: K, value: Scenario[K]): void {
    resumeEditing();
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateStep(index: number, key: string, value: unknown): void {
    resumeEditing();
    setPendingStepKind(null);
    setDraft((current) => {
      const steps = [...current.steps];
      const record = { ...(steps[index] as unknown as Record<string, unknown>) };
      if (value === undefined || value === null) delete record[key];
      else record[key] = value;
      steps[index] = record as unknown as ScenarioStep;
      return { ...current, steps };
    });
  }

  function replaceStepKind(index: number, token: string): void {
    resumeEditing();
    setPendingStepKind(null);
    setDraft((current) => {
      const prior = current.steps[index];
      const replacement = newStep(token);
      const steps = [...current.steps];
      steps[index] = {
        ...replacement,
        ...(prior?.id ? { id: prior.id } : {}),
        ...(prior?.label ? { label: prior.label } : {}),
      } as ScenarioStep;
      return { ...current, steps };
    });
  }

  function requestStepKindChange(index: number, token: string): void {
    const current = draft.steps[index];
    if (!current || stepToken(current) === token) return;
    if (stepKindChangeNeedsConfirmation(current, token)) {
      setPendingStepKind({ index, fromToken: stepToken(current), toToken: token });
      return;
    }
    replaceStepKind(index, token);
  }

  function confirmStepKindChange(): void {
    if (!pendingStepKind) return;
    const current = draft.steps[pendingStepKind.index];
    if (current && stepToken(current) === pendingStepKind.fromToken) {
      replaceStepKind(pendingStepKind.index, pendingStepKind.toToken);
      window.requestAnimationFrame(() => stepTypeRef.current?.focus());
      return;
    }
    setPendingStepKind(null);
  }

  function cancelStepKindChange(): void {
    setPendingStepKind(null);
    window.requestAnimationFrame(() => stepTypeRef.current?.focus());
  }

  function addStep(): void {
    resumeEditing();
    setPendingStepKind(null);
    setDraft((current) => {
      const steps = [...current.steps, newStep()];
      queueMicrotask(() => setSelectedIndex(steps.length - 1));
      return { ...current, steps };
    });
  }

  function removeStep(index: number): void {
    resumeEditing();
    setPendingStepKind(null);
    setPendingDeleteIndex(null);
    setDraft((current) => {
      const steps = current.steps.filter((_, candidate) => candidate !== index);
      queueMicrotask(() => setSelectedIndex(Math.max(0, Math.min(index, steps.length - 1))));
      return { ...current, steps };
    });
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => (stepTypeRef.current ?? addStepButtonRef.current)?.focus()));
  }

  function cancelDeleteStep(): void {
    setPendingDeleteIndex(null);
    window.requestAnimationFrame(() => deleteButtonRef.current?.focus());
  }

  function moveStep(index: number, direction: -1 | 1): void {
    const destination = index + direction;
    if (destination < 0 || destination >= draft.steps.length) return;
    resumeEditing();
    setPendingStepKind(null);
    setDraft((current) => {
      const steps = [...current.steps];
      [steps[index], steps[destination]] = [steps[destination]!, steps[index]!];
      return { ...current, steps };
    });
    setSelectedIndex(destination);
  }

  function applyJson(): Scenario | null {
    try {
      const input = JSON.parse(jsonText) as unknown;
      const checked = validateScenario(input);
      if (!checked.ok) {
        setJsonError(errorSummary(checked.errors));
        setJsonUnvalidated(true);
        return null;
      }
      setDraft(checked.scenario);
      setJsonText(formatScenario(checked.scenario));
      setTagsText((checked.scenario.tags ?? []).join(', '));
      setJsonError('');
      setJsonUnvalidated(false);
      setActionError('');
      setSelectedIndex((current) => Math.max(0, Math.min(current, checked.scenario.steps.length - 1)));
      return checked.scenario;
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : String(error));
      setJsonUnvalidated(true);
      return null;
    }
  }

  function changeMode(next: EditorMode): void {
    if (next === mode) return;
    if (next === 'json') {
      setJsonText(formatScenario(draft));
      setJsonError('');
      setJsonUnvalidated(false);
      setActionError('');
      setPendingStepKind(null);
      setMode('json');
      return;
    }
    // Merely viewing the generated JSON must never trap an invalid Builder draft
    // (for example, the blank step created by “Copy with new step”). Only JSON
    // that the user actually changed needs to be parsed and applied.
    if (!jsonUnvalidated) {
      setJsonError('');
      setPendingStepKind(null);
      setMode('form');
      return;
    }
    if (applyJson()) {
      setPendingStepKind(null);
      setMode('form');
    }
  }

  function materialize(): Scenario | null {
    if (mode === 'json') return applyJson();
    const checked = validateScenario(draft);
    if (!checked.ok) {
      setShowAllIssues(true);
      const stepMatch = checked.errors[0]?.path.match(/^steps\[(\d+)\]/);
      if (stepMatch) setSelectedIndex(Number(stepMatch[1]));
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => sheetRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()));
      return null;
    }
    return checked.scenario;
  }

  async function save(): Promise<void> {
    if (busy) return;
    const value = materialize();
    if (!value) return;
    setActiveAction('save');
    setActionError('');
    try {
      await onSave(value);
    } catch (error) {
      setActionError(`Save failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActiveAction(null);
    }
  }

  async function run(): Promise<void> {
    if (busy || effectiveRunBlockedReason) return;
    const value = materialize();
    if (!value) return;
    if (collectScenarioDependencies(value).secretRefs.length) {
      setActionError('Run blocked: Secret vault execution is not connected. Save the scenario and run it after a vault resolver is configured.');
      return;
    }
    setActiveAction('run');
    setActionError('');
    try {
      await onRun(value);
    } catch (error) {
      setActionError(`Run failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setActiveAction(null);
    }
  }

  function confirmDiscard(): void {
    if (busy) return;
    setDiscardConfirmationOpen(false);
    onClose();
  }

  function keepEditing(): void {
    setDiscardConfirmationOpen(false);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
  }

  return (
    <div className="scenario-editor-layer" role="dialog" aria-modal="true" aria-label="Scenario editor" aria-busy={busy}>
      <button type="button" className="scenario-editor-scrim" aria-label="Close scenario editor" tabIndex={-1} disabled={busy} onClick={requestClose} />
      <fieldset ref={sheetRef} className="scenario-editor-sheet" aria-describedby="scenario-editor-status" disabled={busy}>
        <header className="scenario-editor-titlebar">
          <div className="scenario-editor-brand"><Zap size={16} /><div><span>AGRUNE SCENARIO</span><strong>{draft.name || 'Untitled scenario'}</strong></div></div>
          <div className="scenario-editor-mode" role="tablist" aria-label="Editor mode">
            <button type="button" role="tab" aria-selected={mode === 'form'} aria-controls="scenario-editor-mode-panel" tabIndex={mode === 'form' ? 0 : -1} className={mode === 'form' ? 'active' : ''} onKeyDown={moveEditorTabFocus} onClick={() => changeMode('form')}><Code2 size={13} /> Builder</button>
            <button type="button" role="tab" aria-selected={mode === 'json'} aria-controls="scenario-editor-mode-panel" tabIndex={mode === 'json' ? 0 : -1} className={mode === 'json' ? 'active' : ''} onKeyDown={moveEditorTabFocus} onClick={() => changeMode('json')}><FileJson2 size={13} /> JSON</button>
          </div>
          <button ref={closeButtonRef} type="button" className="scenario-editor-close" aria-label="Close editor" disabled={busy} onClick={requestClose}><X size={17} /></button>
        </header>

        {mode === 'form' ? (
          <div id="scenario-editor-mode-panel" className="scenario-editor-body" role="tabpanel" aria-label="Scenario builder">
            <aside className="scenario-editor-outline">
              <div className="scenario-editor-meta">
                <Field label="Scenario name" error={issues.find((issue) => issue.path === 'name')?.message}>
                  <input ref={initialFocusRef} aria-label="Scenario name" aria-invalid={Boolean(issues.find((issue) => issue.path === 'name'))} value={draft.name} onChange={(event) => setScenarioField('name', event.target.value)} placeholder="Member search stays usable" />
                </Field>
                <Field label="Intent">
                  <textarea aria-label="Scenario intent" value={draft.description ?? ''} onChange={(event) => setScenarioField('description', event.target.value || undefined)} placeholder="Describe the behavior this flow protects." />
                </Field>
                <div className="scenario-editor-meta-grid">
                  <Field label="Start URL">
                    <input aria-label="Scenario start URL" value={draft.url ?? ''} onChange={(event) => setScenarioField('url', event.target.value || undefined)} placeholder="http://127.0.0.1:4178" />
                  </Field>
                  <Field label="Tags">
                    <input aria-label="Scenario tags" value={tagsText} onChange={(event) => {
                      setTagsText(event.target.value);
                      const tags = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean);
                      setScenarioField('tags', tags.length ? tags : undefined);
                    }} placeholder="smoke, critical" />
                  </Field>
                </div>
              </div>

              <div className="scenario-editor-step-heading"><div><span>STEPS</span><strong>{draft.steps.length}</strong></div>{draft.steps.length > 0 && <button ref={addStepButtonRef} type="button" onClick={addStep}><Plus size={13} /> Add</button>}</div>
              <div className="scenario-editor-step-list">
                {draft.steps.map((step, index) => (
                  <button
                    type="button"
                    aria-pressed={index === selectedIndex}
                    key={step.id ?? `${stepToken(step)}-${index}`}
                    className={index === selectedIndex ? 'selected' : ''}
                    onClick={() => { setPendingStepKind(null); setPendingDeleteIndex(null); setSelectedIndex(index); }}
                    aria-label={`Edit step ${index + 1}: ${stepTitle(step)}`}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div><strong>{stepTitle(step)}</strong><code>{stepDetail(step)}</code></div>
                    {issues.some((issue) => issue.path.startsWith(`steps[${index}]`)) && <TriangleAlert size={13} className="invalid" />}
                  </button>
                ))}
                {!draft.steps.length && <div className="scenario-editor-no-steps"><Braces size={18} /><strong>No steps yet</strong><span>Add a semantic action or assertion.</span></div>}
              </div>
            </aside>

            <main className="scenario-editor-detail">
              {selectedStep ? (
                <>
                  <header>
                    <div><span>STEP {String(selectedIndex + 1).padStart(2, '0')}</span><h2>{stepTitle(selectedStep)}</h2></div>
                    <div>
                      <button type="button" aria-label="Move step up" disabled={selectedIndex === 0} onClick={() => moveStep(selectedIndex, -1)}><ArrowUp size={14} /></button>
                      <button type="button" aria-label="Move step down" disabled={selectedIndex === draft.steps.length - 1} onClick={() => moveStep(selectedIndex, 1)}><ArrowDown size={14} /></button>
                      <button ref={deleteButtonRef} type="button" className="danger" aria-label="Delete step" onClick={() => setPendingDeleteIndex(selectedIndex)}><Trash2 size={14} /></button>
                    </div>
                  </header>
                  {pendingDeleteIndex === selectedIndex && (
                    <div className="scenario-secret-unavailable" role="alert" aria-live="assertive">
                      <TriangleAlert size={13} />
                      <div>
                        <strong>Delete this step?</strong>
                        <p>{stepTitle(selectedStep)} and its settings will be removed from the draft.</p>
                        <div className="scenario-editor-actions">
                          <button ref={deleteCancelRef} type="button" className="secondary" onClick={cancelDeleteStep}>Keep step</button>
                          <button type="button" className="danger" onClick={() => removeStep(selectedIndex)}>Delete step</button>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="scenario-editor-fields">
                    <Field label="Step type" hint="Agrune uses a closed, declarative vocabulary.">
                      <select
                        ref={stepTypeRef}
                        aria-label="Step type"
                        aria-describedby={pendingStepKind?.index === selectedIndex ? 'scenario-step-type-confirmation' : undefined}
                        value={stepToken(selectedStep)}
                        onChange={(event) => requestStepKindChange(selectedIndex, event.target.value)}
                      >
                        <optgroup label="Actions">
                          {SCENARIO_STEP_CATALOG.filter((item) => item.family === 'action').map((item) => <option key={`action:${item.kind}`} value={`action:${item.kind}`}>{item.label}</option>)}
                        </optgroup>
                        <optgroup label="Assertions">
                          {SCENARIO_STEP_CATALOG.filter((item) => item.family === 'assertion').map((item) => <option key={`assertion:${item.kind}`} value={`assertion:${item.kind}`}>{item.label}</option>)}
                        </optgroup>
                      </select>
                    </Field>
                    {pendingStepKind?.index === selectedIndex && (
                      <div id="scenario-step-type-confirmation" className="scenario-secret-unavailable" role="alert" aria-live="assertive">
                        <TriangleAlert size={13} />
                        <div>
                          <strong>Replace configured step fields?</strong>
                          <p>Changing {stepKindLabel(pendingStepKind.fromToken)} to {stepKindLabel(pendingStepKind.toToken)} removes fields that only belong to the current type.</p>
                          <div className="scenario-editor-actions">
                            <button ref={stepTypeCancelRef} type="button" className="secondary" onClick={cancelStepKindChange}>Keep current type</button>
                            <button type="button" className="danger" onClick={confirmStepKindChange}>Change type</button>
                          </div>
                        </div>
                      </div>
                    )}
                    <Field label="Human label" hint="Shown in the live run timeline.">
                      <input aria-label="Step label" value={selectedStep.label ?? ''} onChange={(event) => updateStep(selectedIndex, 'label', event.target.value || undefined)} placeholder={stepTitle({ ...selectedStep, label: undefined } as ScenarioStep)} />
                    </Field>
                    <StepFields
                      step={selectedStep}
                      stepIndex={selectedIndex}
                      issues={issues}
                      update={updateStep}
                      targetOptions={targetOptions}
                      targetInputRef={initialFocusTarget ? targetFocusRef : undefined}
                    />
                  </div>
                </>
              ) : (
                <div className="scenario-editor-empty-detail"><Braces size={28} /><h2>Build the browser contract</h2><p>Each step addresses a manifest target or checks a stable browser signal. There is no arbitrary JavaScript escape hatch.</p><button ref={addStepButtonRef} type="button" onClick={addStep}><Plus size={14} /> Add first step</button></div>
              )}
            </main>
          </div>
        ) : (
          <div id="scenario-editor-mode-panel" className="scenario-json-editor" role="tabpanel" aria-label="Scenario JSON">
            <header><div><FileJson2 size={15} /><div><strong>Portable Agrune syntax</strong><span>agrune.scenario/v1 · strict fields · no arbitrary code</span></div></div><button type="button" onClick={applyJson}><Check size={13} /> Validate &amp; apply</button></header>
            <textarea
              aria-label="Scenario JSON"
              aria-invalid={Boolean(jsonError)}
              aria-describedby={jsonError ? 'scenario-json-error scenario-editor-status' : 'scenario-editor-status'}
              spellCheck={false}
              value={jsonText}
              onChange={(event) => {
                resumeEditing();
                setJsonText(event.target.value);
                setJsonError('');
                setJsonUnvalidated(true);
              }}
            />
            {jsonError && <pre id="scenario-json-error" className="scenario-json-error" role="alert">{jsonError}</pre>}
          </div>
        )}

        <footer className="scenario-editor-footer">
          <div id="scenario-editor-status" className={footerProblem ? 'invalid' : 'valid'} role="status" aria-live="polite" aria-atomic="true">
            {footerProblem ? <TriangleAlert size={14} /> : <Check size={14} />}
            <span>{footerText}</span>
            {!!visibleIssues.length && <button type="button" aria-expanded={showAllIssues} aria-controls="scenario-editor-issue-list" onClick={() => setShowAllIssues((value) => !value)}>{showAllIssues ? 'Hide issue details' : 'Show issue details'}</button>}
          </div>
          <div className="scenario-editor-actions">
            <button type="button" className="secondary" disabled={busy} onClick={requestClose}>Cancel</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void save()}><Save size={14} /> {isSaving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="primary" disabled={busy || Boolean(effectiveRunBlockedReason)} title={effectiveRunBlockedReason} onClick={() => void run()}><Play size={14} fill="currentColor" /> {isRunning ? 'Running…' : 'Run draft'}</button>
          </div>
          {showAllIssues && !!visibleIssues.length && <div id="scenario-editor-issue-list" className="scenario-editor-issues">{visibleIssues.map((issue, index) => <div key={`${issue.path}-${index}`}><code>{issue.path || 'scenario'}</code><span>{issue.message}</span></div>)}</div>}
          {discardConfirmationOpen && (
            <div className="scenario-editor-issues" role="alertdialog" aria-labelledby="scenario-discard-title" aria-describedby="scenario-discard-description">
              <div>
                <strong id="scenario-discard-title">Discard unsaved changes?</strong>
                <div>
                  <span id="scenario-discard-description">Your edits have not been saved or run. This cannot be undone.</span>
                  <div className="scenario-editor-actions">
                    <button ref={discardCancelRef} type="button" className="secondary" disabled={busy} onClick={keepEditing}>Keep editing</button>
                    <button type="button" className="danger" disabled={busy} onClick={confirmDiscard}>Discard changes</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </footer>
        <datalist id="agrune-target-refs">{targetOptions.map((target) => <option key={target} value={target} />)}</datalist>
      </fieldset>
    </div>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }): JSX.Element {
  const errorId = useId();
  let control = children;
  if (error && isValidElement(children)) {
    const child = children as ReactElement<{ 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
    control = cloneElement(child, {
      'aria-invalid': true,
      'aria-describedby': [child.props['aria-describedby'], errorId].filter(Boolean).join(' '),
    });
  }
  return <label className={error ? 'scenario-field invalid' : 'scenario-field'}><span>{label}{hint && <small>{hint}</small>}</span>{control}{error && <em id={errorId}>{error}</em>}</label>;
}

type PlaywrightFallbackStrategy = PlaywrightFallbackLocator['by'];
type PlaywrightFallbackDraft = PlaywrightFallbackLocator;

const PLAYWRIGHT_ROLE_SUGGESTIONS = [
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'option',
  'tab',
  'menuitem',
] as const;

function PlaywrightRecoveryCard({
  fallback,
  defaultStrategy,
  defaultRole,
  issueFor,
  onChange,
  disabledReason,
}: {
  fallback?: PlaywrightFallbackDraft;
  defaultStrategy: PlaywrightFallbackStrategy;
  defaultRole?: string;
  issueFor: (key?: string) => string | undefined;
  onChange: (next: PlaywrightFallbackDraft | undefined) => void;
  disabledReason?: string;
}): JSX.Element {
  const enabled = fallback !== undefined && !disabledReason;
  const descriptionId = 'scenario-playwright-recovery-description';

  function enable(): void {
    onChange({
      by: defaultStrategy,
      ...(defaultStrategy === 'role' && defaultRole ? { role: defaultRole } : {}),
      name: '',
    });
  }

  function updateFallback(patch: Partial<PlaywrightFallbackDraft>): void {
    if (!fallback) return;
    onChange({ ...fallback, ...patch });
  }

  function changeStrategy(by: PlaywrightFallbackStrategy): void {
    if (!fallback) return;
    const next: PlaywrightFallbackDraft = { ...fallback, by };
    if (by === 'role') next.role = fallback.role || defaultRole || 'button';
    else delete next.role;
    onChange(next);
  }

  const nameLabel = fallback?.by === 'label'
    ? 'Form label'
    : fallback?.by === 'placeholder'
      ? 'Placeholder text'
      : fallback?.by === 'testId'
        ? 'Test ID'
        : 'Accessible name';
  const namePlaceholder = fallback?.by === 'label'
    ? 'Email address'
    : fallback?.by === 'placeholder'
      ? 'you@example.com'
      : fallback?.by === 'testId'
        ? 'checkout-submit'
        : 'Continue';

  return (
    <section className={`scenario-playwright-recovery${enabled ? ' enabled' : ''}${disabledReason ? ' unavailable' : ''}`} aria-label="Playwright recovery">
      <header>
        <div>
          <strong>Playwright recovery</strong>
          <span>Optional</span>
        </div>
        <label className="scenario-playwright-switch">
          <input
            type="checkbox"
            aria-label="Enable Playwright recovery"
            aria-describedby={descriptionId}
            checked={enabled}
            disabled={Boolean(disabledReason)}
            onChange={(event) => event.target.checked ? enable() : onChange(undefined)}
          />
          <span>{enabled ? 'Enabled' : 'Enable'}</span>
        </label>
      </header>
      <p id={descriptionId}>
        The manifest target always runs first. Add one stable, user-facing locator only as a recovery path when that target cannot resolve.
      </p>

      {disabledReason ? (
        <div className="scenario-playwright-unavailable" role="note">
          <TriangleAlert size={13} />
          <span>{disabledReason}</span>
        </div>
      ) : enabled && fallback ? (
        <>
          <div className="scenario-playwright-fields">
            <Field label="Locator strategy" hint="Prefer role when possible." error={issueFor('by')}>
              <select
                aria-label="Playwright recovery strategy"
                value={fallback.by}
                onChange={(event) => changeStrategy(event.target.value as PlaywrightFallbackStrategy)}
              >
                <option value="role">Role + accessible name</option>
                <option value="label">Form label</option>
                <option value="placeholder">Placeholder text</option>
                <option value="testId">Test ID</option>
              </select>
            </Field>
            {fallback.by === 'role' && (
              <Field label="ARIA role" error={issueFor('role')}>
                <input
                  aria-label="Playwright recovery ARIA role"
                  list="agrune-playwright-roles"
                  value={fallback.role ?? ''}
                  onChange={(event) => updateFallback({ role: event.target.value })}
                  placeholder="button"
                />
              </Field>
            )}
            <div className="scenario-playwright-name-field">
              <Field label={nameLabel} hint="What a user sees or assistive tech reads." error={issueFor('name')}>
                <input
                  aria-label={`Playwright recovery ${nameLabel.toLowerCase()}`}
                  value={fallback.name}
                  onChange={(event) => updateFallback({ name: event.target.value })}
                  placeholder={namePlaceholder}
                />
              </Field>
            </div>
          </div>
          <label className="scenario-playwright-exact">
            <input
              type="checkbox"
              checked={fallback.exact !== false}
              onChange={(event) => {
                const next = { ...fallback };
                if (event.target.checked) delete next.exact;
                else next.exact = false;
                onChange(next);
              }}
            />
            <span><strong>Exact match</strong><small>Require the locator text to match exactly.</small></span>
          </label>
          {issueFor('exact') && <em className="scenario-playwright-error">{issueFor('exact')}</em>}
          {issueFor() && <em className="scenario-playwright-error">{issueFor()}</em>}
        </>
      ) : (
        <span className="scenario-playwright-off">Keep this off while the manifest target is healthy.</span>
      )}
      <datalist id="agrune-playwright-roles">
        {PLAYWRIGHT_ROLE_SUGGESTIONS.map((role) => <option key={role} value={role} />)}
      </datalist>
    </section>
  );
}

function StepFields({
  step,
  stepIndex,
  issues,
  update,
  targetOptions,
  targetInputRef,
}: {
  step: ScenarioStep;
  stepIndex: number;
  issues: ScenarioValidationIssue[];
  update: (index: number, key: string, value: unknown) => void;
  targetOptions: string[];
  targetInputRef?: RefObject<HTMLInputElement | null>;
}): JSX.Element {
  const record = step as unknown as Record<string, unknown>;
  const issueFor = (key: string): string | undefined => issues.find((issue) => issue.path === `steps[${stepIndex}].${key}`)?.message;
  const text = (key: string): string => typeof record[key] === 'string' ? record[key] as string : '';
  const numberValue = (key: string): number | '' => typeof record[key] === 'number' ? record[key] as number : '';
  const updateNumber = (key: string, value: string): void => update(stepIndex, key, value === '' ? undefined : Number(value));
  const rawPlaywrightFallback = record.playwrightFallback;
  const playwrightFallback = typeof rawPlaywrightFallback === 'object' && rawPlaywrightFallback !== null
    ? rawPlaywrightFallback as PlaywrightFallbackDraft
    : undefined;
  const playwrightIssueFor = (key?: string): string | undefined => {
    const path = `steps[${stepIndex}].playwrightFallback${key ? `.${key}` : ''}`;
    return issues.find((issue) => issue.path === path)?.message;
  };
  const targetField = (label = 'Manifest target', key = 'ref'): JSX.Element => (
    <Field label={label} hint={targetOptions.length ? `${targetOptions.length} targets currently perceived` : 'Use a declared manifest ref.'} error={issueFor(key)}>
      <input ref={targetInputRef} aria-label={label} list="agrune-target-refs" value={text(key)} onChange={(event) => update(stepIndex, key, event.target.value)} placeholder="navigation.nav_board_tab" />
    </Field>
  );
  const recoveryCard = (
    defaultStrategy: PlaywrightFallbackStrategy = 'role',
    defaultRole?: string,
    disabledReason?: string,
  ): JSX.Element => (
    <PlaywrightRecoveryCard
      fallback={playwrightFallback}
      defaultStrategy={defaultStrategy}
      defaultRole={defaultRole}
      issueFor={playwrightIssueFor}
      onChange={(next) => update(stepIndex, 'playwrightFallback', next)}
      disabledReason={disabledReason}
    />
  );

  if ('do' in step) {
    switch (step.do) {
      case 'navigate':
        return <Field label="URL or route" hint="Absolute http(s), or relative to the current/scenario URL." error={issueFor('url')}><input aria-label="Navigation URL" value={text('url')} onChange={(event) => update(stepIndex, 'url', event.target.value)} placeholder="/members" /></Field>;
      case 'click':
      case 'dblclick':
      case 'contextmenu':
      case 'hover':
      case 'longpress':
        return <>{targetField()}{recoveryCard('role', 'button')}</>;
      case 'check':
      case 'uncheck':
        return <>{targetField()}{recoveryCard('label')}</>;
      case 'fill': {
        const secret = 'secretRef' in step;
        const unavailableNoteId = `scenario-secret-unavailable-${stepIndex}`;
        return <>{targetField()}<div className="scenario-secret-toggle"><label title="Secret vault execution is not connected yet."><input type="checkbox" checked={secret} disabled aria-describedby={unavailableNoteId} /><span>Use a secret vault reference</span><small>Not yet executable</small></label></div><div id={unavailableNoteId} className="scenario-secret-unavailable" role="note"><TriangleAlert size={13} /><span>Secret vault execution is not connected yet. Existing <code>secretRef</code> steps are preserved and can be inspected here or edited in JSON, but they cannot run in Studio yet.</span></div>{secret ? <Field label="Secret ref" hint="Read-only in Builder until the vault resolver is connected; use JSON to preserve or edit it." error={issueFor('secretRef')}><input aria-label="Secret reference" value={text('secretRef')} readOnly aria-describedby={unavailableNoteId} /></Field> : <Field label="Value" hint="Literal values are hidden from timeline summaries." error={issueFor('value')}><textarea aria-label="Fill value" value={text('value')} onChange={(event) => update(stepIndex, 'value', event.target.value)} /></Field>}<div className="scenario-inline-fields"><Field label="Fill strategy"><select aria-label="Fill strategy" value={text('strategy') || 'auto'} onChange={(event) => update(stepIndex, 'strategy', event.target.value === 'auto' ? undefined : event.target.value)}><option value="auto">Auto</option><option value="insert">Insert</option><option value="keystroke">Keystroke</option></select></Field><label className="scenario-check-field"><input type="checkbox" checked={record.clear !== false} onChange={(event) => update(stepIndex, 'clear', event.target.checked ? undefined : false)} /><span>Clear first</span></label></div>{secret ? recoveryCard('label', undefined, 'Recovery locators are disabled for secret fills. Sensitive input stays manifest-only.') : recoveryCard('label')}</>;
      }
      case 'type':
        return <>{targetField()}<Field label="Text" error={issueFor('text')}><textarea aria-label="Typed text" value={text('text')} onChange={(event) => update(stepIndex, 'text', event.target.value)} /></Field><div className="scenario-inline-fields"><Field label="Delay per key (ms)"><input aria-label="Typing delay" type="number" min="0" max="10000" value={numberValue('delayMs')} placeholder="0" onChange={(event) => updateNumber('delayMs', event.target.value)} /></Field><label className="scenario-check-field"><input type="checkbox" checked={record.submit === true} onChange={(event) => update(stepIndex, 'submit', event.target.checked ? true : undefined)} /><span>Submit with Enter</span></label></div>{recoveryCard('label')}</>;
      case 'press':
        return <><Field label="Key" hint="Playwright key name, for example Enter or Control+K." error={issueFor('key')}><input aria-label="Keyboard key" value={text('key')} onChange={(event) => update(stepIndex, 'key', event.target.value)} placeholder="Enter" /></Field>{targetField('Target (optional)')}<Field label="Delay (ms)"><input aria-label="Key delay" type="number" min="0" max="10000" value={numberValue('delayMs')} placeholder="0" onChange={(event) => updateNumber('delayMs', event.target.value)} /></Field>{(text('ref') || playwrightFallback) && recoveryCard('role', 'button')}</>;
      case 'select':
        return <>{targetField()}<Field label="Option value" error={issueFor('value')}><input aria-label="Select value" value={text('value')} onChange={(event) => update(stepIndex, 'value', event.target.value)} /></Field>{recoveryCard('label')}</>;
      case 'wait':
        return <Field label="Duration (ms)" hint="Bounded to 60 seconds." error={issueFor('ms')}><input aria-label="Wait duration" type="number" min="0" max="60000" value={numberValue('ms')} placeholder="500" onChange={(event) => updateNumber('ms', event.target.value)} /></Field>;
      case 'waitFor':
        return <>{targetField()}<div className="scenario-inline-fields"><Field label="Required state"><select aria-label="Wait target state" value={text('state') || 'visible'} onChange={(event) => update(stepIndex, 'state', event.target.value === 'visible' ? undefined : event.target.value)}><option value="visible">Visible</option><option value="hidden">Hidden</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></Field><Field label="Timeout (ms)"><input aria-label="Wait timeout" type="number" min="0" max="120000" value={numberValue('timeoutMs')} placeholder="10000" onChange={(event) => updateNumber('timeoutMs', event.target.value)} /></Field></div>{recoveryCard('role', 'button')}</>;
    }
  }

  switch (step.assert) {
    case 'urlContains':
    case 'urlEquals':
    case 'titleContains':
    case 'textPresent':
    case 'textAbsent':
      return <Field label="Expected value" error={issueFor('value')}><textarea aria-label="Expected value" value={text('value')} onChange={(event) => update(stepIndex, 'value', event.target.value)} /></Field>;
    case 'targetVisible':
    case 'targetHidden':
    case 'targetEnabled':
    case 'targetDisabled':
      return targetField('Manifest target to assert');
    case 'targetCount':
      return <div className="scenario-inline-fields"><Field label="Repeat ID" error={issueFor('repeat')}><input aria-label="Repeat ID" value={text('repeat')} onChange={(event) => update(stepIndex, 'repeat', event.target.value)} /></Field><Field label="Expected count" error={issueFor('count')}><input aria-label="Expected repeat count" type="number" min="0" value={numberValue('count')} placeholder="1" onChange={(event) => updateNumber('count', event.target.value)} /></Field></div>;
    case 'networkStatus':
      return <><Field label="URL contains" error={issueFor('urlContains')}><input aria-label="Network URL fragment" value={text('urlContains')} onChange={(event) => update(stepIndex, 'urlContains', event.target.value)} placeholder="/api/orders" /></Field><div className="scenario-inline-fields"><Field label="HTTP method"><input aria-label="HTTP method" value={text('method')} onChange={(event) => update(stepIndex, 'method', event.target.value.toUpperCase() || undefined)} placeholder="Any" /></Field><Field label="Expected status" error={issueFor('status')}><input aria-label="Expected HTTP status" type="number" min="100" max="599" value={numberValue('status')} placeholder="200" onChange={(event) => updateNumber('status', event.target.value)} /></Field></div></>;
    case 'noConsoleErrors':
      return <div className="scenario-closed-assertion"><Check size={18} /><div><strong>No configuration needed</strong><span>The runner checks console errors produced after this run starts.</span></div></div>;
  }
}
