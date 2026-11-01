import type { StudioApi } from './shared/contracts';

declare global {
  interface Window {
    agruneStudio: StudioApi;
  }
}

export {};
