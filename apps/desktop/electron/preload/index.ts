import { contextBridge, ipcRenderer } from 'electron';

export type PlatformInfo = {
  platform: NodeJS.Platform;
  arch: string;
  version: string;
  node: string;
  electron: string;
};

const flowstateApi = {
  platform: (): Promise<PlatformInfo> => ipcRenderer.invoke('flowstate:platform'),
};

contextBridge.exposeInMainWorld('flowstate', flowstateApi);

export type FlowstateApi = typeof flowstateApi;
