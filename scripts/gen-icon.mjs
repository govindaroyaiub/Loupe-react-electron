// Wire the user-supplied AppIcons set into Electron's expected paths:
//   - resources/icon.png   (1024×1024, used at runtime by main process)
//   - build/icon.png       (1024×1024, electron-builder fallback for Win/Linux)
//   - build/icon.icns      (multi-resolution macOS bundle icon)
//
// Source assets live in AppIcons/Assets.xcassets/AppIcon.appiconset/<size>.png.
// We pick the sizes Apple's iconutil expects and `iconutil` packs them.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = process.cwd()
const SRC_DIR = path.join(ROOT, 'AppIcons', 'Assets.xcassets', 'AppIcon.appiconset')

// The macOS .icns format expects these specific filenames (Apple HIG).
// Map each entry to the source PNG size that should fill it.
const ICONSET_ENTRIES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
]

function readSrc(size) {
  const file = path.join(SRC_DIR, `${size}.png`)
  if (!fs.existsSync(file)) {
    throw new Error(`Missing source icon ${size}.png at ${file}`)
  }
  return fs.readFileSync(file)
}

// 1024 PNG for runtime + Win/Linux fallback.
const png1024 = readSrc(1024)
fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), png1024)
fs.writeFileSync(path.join(ROOT, 'resources', 'icon.png'), png1024)

// macOS .icns — build an iconset and run iconutil.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loupe-icon-'))
const iconsetDir = path.join(tmpRoot, 'icon.iconset')
fs.mkdirSync(iconsetDir)
for (const [name, size] of ICONSET_ENTRIES) {
  fs.writeFileSync(path.join(iconsetDir, name), readSrc(size))
}

const icnsOut = path.join(ROOT, 'build', 'icon.icns')
execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsOut}"`, { stdio: 'inherit' })
fs.rmSync(tmpRoot, { recursive: true, force: true })

console.log('wrote build/icon.png, resources/icon.png, build/icon.icns from AppIcons/')
