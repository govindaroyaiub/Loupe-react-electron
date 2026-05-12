import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { FileFilter } from 'electron'

const loupe = {
  pickAndParsePsd: () => ipcRenderer.invoke('psd:pick-and-parse'),
  parsePsd: (filePath: string) => ipcRenderer.invoke('psd:parse', filePath),
  onMenuOpenPsd: (handler: () => void) => {
    const listener = (_e: IpcRendererEvent) => handler()
    ipcRenderer.on('menu:open-psd', listener)
    return () => ipcRenderer.off('menu:open-psd', listener)
  },
  onCanvasAction: (handler: (action: string) => void) => {
    const listener = (_e: IpcRendererEvent, action: string) => handler(action)
    ipcRenderer.on('menu:canvas', listener)
    return () => ipcRenderer.off('menu:canvas', listener)
  },
  showSaveDialog: (opts: { defaultPath?: string; filters?: FileFilter[] }) =>
    ipcRenderer.invoke('fs:show-save-dialog', opts) as Promise<string | null>,
  showFolderDialog: (opts: { defaultPath?: string }) =>
    ipcRenderer.invoke('fs:show-folder-dialog', opts) as Promise<string | null>,
  writeFile: (filePath: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('fs:write-file', filePath, bytes) as Promise<true>,
  showInFolder: (filePath: string) =>
    ipcRenderer.invoke('shell:show-in-folder', filePath) as Promise<true>,
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('loupe', loupe)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.loupe = loupe
}

export type LoupeApi = typeof loupe
