import { ElectronAPI } from '@electron-toolkit/preload'
import type { FileFilter } from 'electron'
import type { ParsedPsd } from '../main/psd'

export interface LoupeApi {
  pickAndParsePsd: () => Promise<{ filePath: string; parsed: ParsedPsd } | null>
  parsePsd: (filePath: string) => Promise<ParsedPsd>
  onMenuOpenPsd: (handler: () => void) => () => void
  onCanvasAction: (handler: (action: string) => void) => () => void
  showSaveDialog: (opts: { defaultPath?: string; filters?: FileFilter[] }) => Promise<string | null>
  showFolderDialog: (opts: { defaultPath?: string }) => Promise<string | null>
  writeFile: (filePath: string, bytes: Uint8Array) => Promise<true>
  showInFolder: (filePath: string) => Promise<true>
}

declare global {
  interface Window {
    electron: ElectronAPI
    loupe: LoupeApi
  }
}
