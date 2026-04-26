/// <reference types="vite/client" />

import type { FlowstateApi } from '../electron/preload';

declare global {
  interface Window {
    flowstate: FlowstateApi;
  }
}

export {};
