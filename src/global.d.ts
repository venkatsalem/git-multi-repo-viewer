/// <reference types="vite/client" />
import type { GitViewerApi } from '../electron/preload';

declare global {
  interface Window {
    gitViewer: GitViewerApi;
  }
}

export {};
