import { app, shell, BrowserWindow, ipcMain, dialog, Menu, MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { promises as fsp } from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import icon from '../../resources/icon.png?asset'
import { isImageExt, parseImageFile, parsePsdFile } from './psd'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#1e1e22',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.maximize()
    mainWindow?.show()
  })

  // Intercept zoom keys at the webContents level so neither the menu accelerator
  // parsing nor Chromium's built-in browser zoom can swallow them.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    // Platform-correct modifier: Cmd on macOS, Ctrl elsewhere.
    const modifier = process.platform === 'darwin' ? input.meta : input.control
    if (!modifier) return
    let action: string | null = null
    if (input.code === 'Minus') action = 'zoom-out'
    else if (input.code === 'Equal') action = 'zoom-in'
    else if (input.code === 'Digit0' || input.code === 'Numpad0') action = 'zoom-100'
    else if (input.code === 'Digit1' || input.code === 'Numpad1') action = 'zoom-fit'
    if (action) {
      event.preventDefault()
      sendCanvas(action)
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function openFilesDialog(): Promise<string[]> {
  const result = await dialog.showOpenDialog({
    title: 'Open files',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'PSD or image', extensions: ['psd', 'png', 'jpg', 'jpeg'] },
      { name: 'Photoshop', extensions: ['psd'] },
      { name: 'Image', extensions: ['png', 'jpg', 'jpeg'] },
    ],
  })
  if (result.canceled) return []
  return result.filePaths
}

function triggerOpenFromMenu(): void {
  if (!mainWindow) return
  mainWindow.webContents.send('menu:open-psd')
}

function sendCanvas(action: string): void {
  if (!mainWindow) return
  mainWindow.webContents.send('menu:canvas', action)
}

function sendUpdate(event: string, payload?: unknown): void {
  if (!mainWindow) return
  mainWindow.webContents.send('update:event', { event, payload })
}

function setupAutoUpdater(): void {
  // Don't try to check for updates while running in dev.
  if (is.dev) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => sendUpdate('checking'))
  autoUpdater.on('update-available', (info) => sendUpdate('available', info))
  autoUpdater.on('update-not-available', (info) => sendUpdate('not-available', info))
  autoUpdater.on('error', (err) => sendUpdate('error', String(err)))
  autoUpdater.on('download-progress', (p) => sendUpdate('progress', p))
  autoUpdater.on('update-downloaded', (info) => sendUpdate('downloaded', info))

  autoUpdater.checkForUpdates().catch(() => {})
  // Re-check every 4 hours while the app stays open.
  setInterval(
    () => {
      autoUpdater.checkForUpdates().catch(() => {})
    },
    4 * 60 * 60 * 1000,
  )
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File…',
          accelerator: 'CmdOrCtrl+O',
          click: triggerOpenFromMenu,
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', click: () => sendCanvas('zoom-in') },
        { label: 'Zoom Out', click: () => sendCanvas('zoom-out') },
        { label: 'Actual Size', click: () => sendCanvas('zoom-100') },
        { label: 'Fit to Window', click: () => sendCanvas('zoom-fit') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        // On macOS the system auto-injects "Enter Full Screen" into any
        // menu labeled "View" — adding our own role here would produce a
        // duplicate. On Windows/Linux there is no such injection, so we
        // provide it explicitly there.
        ...(isMac
          ? []
          : ([{ type: 'separator' }, { role: 'togglefullscreen' }] as MenuItemConstructorOptions[])),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.loupe.app')

  // macOS dev: the packaged .icns isn't present, so the dock falls back to the
  // generic Electron icon. Force the bundled PNG so dev matches production.
  if (process.platform === 'darwin') {
    app.dock?.setIcon(icon)
  }

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('psd:pick-and-parse', async () => {
    const filePaths = await openFilesDialog()
    if (filePaths.length === 0) return []
    // Parse in parallel where possible. ag-psd's readPsd is synchronous so
    // PSDs still serialize on the main thread; image parses (PNG/JPG) run
    // concurrently via the napi-rs decoder. One bad file doesn't kill the
    // batch — it's just dropped from the result.
    const settled = await Promise.allSettled(
      filePaths.map(async (fp) => {
        const parsed = isImageExt(fp) ? await parseImageFile(fp) : parsePsdFile(fp)
        return { filePath: fp, parsed }
      }),
    )
    const out: Array<{ filePath: string; parsed: ReturnType<typeof parsePsdFile> }> = []
    for (let i = 0; i < settled.length; i++) {
      const r = settled[i]
      if (r.status === 'fulfilled') out.push(r.value)
      else console.error('[open]', filePaths[i], r.reason)
    }
    return out
  })

  ipcMain.handle('psd:parse', async (_event, filePath: string) => {
    return isImageExt(filePath) ? await parseImageFile(filePath) : parsePsdFile(filePath)
  })

  ipcMain.handle(
    'fs:show-save-dialog',
    async (_event, opts: { defaultPath?: string; filters?: Electron.FileFilter[] }) => {
      const result = await dialog.showSaveDialog({
        defaultPath: opts.defaultPath,
        filters: opts.filters ?? [{ name: 'All Files', extensions: ['*'] }],
      })
      if (result.canceled || !result.filePath) return null
      return result.filePath
    },
  )

  ipcMain.handle('fs:show-folder-dialog', async (_event, opts: { defaultPath?: string }) => {
    const result = await dialog.showOpenDialog({
      defaultPath: opts.defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('fs:write-file', async (_event, filePath: string, bytes: Uint8Array) => {
    await fsp.writeFile(filePath, bytes)
    return true
  })

  ipcMain.handle('shell:show-in-folder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
    return true
  })

  ipcMain.handle('update:check', async () => {
    if (is.dev) return { skipped: 'dev' }
    try {
      const result = await autoUpdater.checkForUpdates()
      return { ok: true, version: result?.updateInfo?.version }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('update:install-now', async () => {
    autoUpdater.quitAndInstall()
    return true
  })

  setupAutoUpdater()

  buildMenu()
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
