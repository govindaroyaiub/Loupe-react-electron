import { app, shell, BrowserWindow, ipcMain, dialog, Menu, MenuItemConstructorOptions } from 'electron'
import { join } from 'path'
import { promises as fsp } from 'node:fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { parsePsdFile } from './psd'

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

async function openPsdDialog(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title: 'Open PSD',
    properties: ['openFile'],
    filters: [{ name: 'Photoshop', extensions: ['psd'] }],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

function triggerOpenFromMenu(): void {
  if (!mainWindow) return
  mainWindow.webContents.send('menu:open-psd')
}

function sendCanvas(action: string): void {
  if (!mainWindow) return
  mainWindow.webContents.send('menu:canvas', action)
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
          label: 'Open PSD…',
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
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.loupe.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('psd:pick-and-parse', async () => {
    const filePath = await openPsdDialog()
    if (!filePath) return null
    const parsed = parsePsdFile(filePath)
    return { filePath, parsed }
  })

  ipcMain.handle('psd:parse', async (_event, filePath: string) => {
    return parsePsdFile(filePath)
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
