// Generate Loupe app icon at 1024x1024 PNG.
// Renders into build/icon.png and resources/icon.png.
import fs from 'node:fs'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'

const SIZE = 1024
const canvas = createCanvas(SIZE, SIZE)
const ctx = canvas.getContext('2d')

// 1. Squircle-ish rounded-rect background with a blue → purple gradient.
const r = SIZE * 0.22 // corner radius — Apple's iOS icon mask is around 22.37%
ctx.beginPath()
ctx.moveTo(r, 0)
ctx.lineTo(SIZE - r, 0)
ctx.quadraticCurveTo(SIZE, 0, SIZE, r)
ctx.lineTo(SIZE, SIZE - r)
ctx.quadraticCurveTo(SIZE, SIZE, SIZE - r, SIZE)
ctx.lineTo(r, SIZE)
ctx.quadraticCurveTo(0, SIZE, 0, SIZE - r)
ctx.lineTo(0, r)
ctx.quadraticCurveTo(0, 0, r, 0)
ctx.closePath()

const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE)
grad.addColorStop(0, '#3d8bfe') // brighter blue top-left
grad.addColorStop(1, '#a563ff') // purple bottom-right
ctx.fillStyle = grad
ctx.fill()

// 2. Subtle inner highlight at the top
const highlight = ctx.createLinearGradient(0, 0, 0, SIZE * 0.5)
highlight.addColorStop(0, 'rgba(255,255,255,0.18)')
highlight.addColorStop(1, 'rgba(255,255,255,0)')
ctx.fillStyle = highlight
ctx.fill()

// 3. The "L" — bold geometric, generous strokes, slightly offset
ctx.save()
ctx.fillStyle = '#ffffff'
ctx.shadowColor = 'rgba(0,0,0,0.18)'
ctx.shadowBlur = 24
ctx.shadowOffsetY = 14

// Draw L as two rounded rectangles for a clean geometric look
const stroke = SIZE * 0.13 // arm thickness
const vertHeight = SIZE * 0.58 // vertical arm height
const horzWidth = SIZE * 0.36 // horizontal arm width
const left = (SIZE - (horzWidth + 0)) / 2 - SIZE * 0.05 // slight left bias for optical center
const top = (SIZE - vertHeight - stroke + SIZE * 0.04) / 2
const cap = stroke / 2 // half-stroke for rounded ends

// Vertical bar
ctx.beginPath()
ctx.moveTo(left + cap, top)
ctx.lineTo(left + stroke - cap, top)
ctx.quadraticCurveTo(left + stroke, top, left + stroke, top + cap)
ctx.lineTo(left + stroke, top + vertHeight + stroke - cap)
ctx.quadraticCurveTo(
  left + stroke,
  top + vertHeight + stroke,
  left + stroke - cap,
  top + vertHeight + stroke,
)
ctx.lineTo(left + cap, top + vertHeight + stroke)
ctx.quadraticCurveTo(left, top + vertHeight + stroke, left, top + vertHeight + stroke - cap)
ctx.lineTo(left, top + cap)
ctx.quadraticCurveTo(left, top, left + cap, top)
ctx.closePath()
ctx.fill()

// Horizontal bar (extends to the right from the bottom of the vertical bar)
const hLeft = left + stroke
const hTop = top + vertHeight
const hRight = hLeft + horzWidth
const hBottom = hTop + stroke
ctx.shadowBlur = 0
ctx.shadowOffsetY = 0
ctx.beginPath()
ctx.moveTo(hLeft, hTop + cap)
ctx.lineTo(hLeft, hTop)
ctx.lineTo(hRight - cap, hTop)
ctx.quadraticCurveTo(hRight, hTop, hRight, hTop + cap)
ctx.lineTo(hRight, hBottom - cap)
ctx.quadraticCurveTo(hRight, hBottom, hRight - cap, hBottom)
ctx.lineTo(hLeft, hBottom)
ctx.closePath()
ctx.fill()

ctx.restore()

const out = canvas.toBuffer('image/png')

const buildDir = path.join(process.cwd(), 'build')
const resDir = path.join(process.cwd(), 'resources')
fs.writeFileSync(path.join(buildDir, 'icon.png'), out)
fs.writeFileSync(path.join(resDir, 'icon.png'), out)
console.log(`wrote ${out.length} bytes to build/icon.png and resources/icon.png`)
