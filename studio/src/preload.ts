import { contextBridge, ipcRenderer } from 'electron';
import type { StudioApi, StudioState } from './shared/contracts';

const api: StudioApi = {
  getState: () => ipcRenderer.invoke('studio:get-state'),
  chooseWorkspace: () => ipcRenderer.invoke('studio:choose-workspace'),
  openWorkspace: (workspacePath) => ipcRenderer.invoke('studio:open-workspace', workspacePath),
  navigate: (url) => ipcRenderer.invoke('studio:navigate', url),
  history: (action) => ipcRenderer.invoke('studio:history', action),
  selectScenario: (scenarioKey) => ipcRenderer.invoke('studio:select-scenario', scenarioKey),
  saveScenario: (request) => ipcRenderer.invoke('studio:save-scenario', request),
  runScenario: (scenario) => ipcRenderer.invoke('studio:run', scenario),
  pauseRun: () => ipcRenderer.invoke('studio:pause'),
  resumeRun: () => ipcRenderer.invoke('studio:resume'),
  stepRun: (scenario) => ipcRenderer.invoke('studio:step', scenario),
  stopRun: () => ipcRenderer.invoke('studio:stop'),
  showBrowser: () => ipcRenderer.invoke('studio:show-browser'),
  highlightTarget: (targetRef) => ipcRenderer.invoke('studio:highlight-target', targetRef),
  openArtifact: (request) => ipcRenderer.invoke('studio:open-artifact', request),
  refresh: () => ipcRenderer.invoke('studio:refresh'),
  onState: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: StudioState) => listener(state);
    ipcRenderer.on('studio:state', wrapped);
    return () => ipcRenderer.removeListener('studio:state', wrapped);
  },
};

contextBridge.exposeInMainWorld('agruneStudio', api);
