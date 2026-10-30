// agent-rtl for opencode: right-to-left Arabic, Persian and Hebrew in the TUI.
//
// Hooks the renderer's post-process step (renderer.addPostProcessFn), which
// runs on every finished frame before it is sent to the terminal, and
// repaints each row that holds RTL text with the plan from rtl-core: RTL runs
// read right to left, Arabic letters joined, English, paths and numbers left
// to right. Only the painted frame changes; stored text, copy/paste and what
// the model sees keep the original letters. OPENCODE_ARABIC_RTL=0 turns it off.
//
// Installed by agent-rtl's install.sh next to rtl-core.mjs and bidi.mjs.

import { hasRtl, planRow } from "./rtl-core.mjs"

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })
const decoder = new TextDecoder("utf-8", { ignoreBOM: true })

// Cell char encoding (opentui grapheme.zig): the top two bits give the type.
// 0 = plain code point, 1 = image, 2 = pooled grapheme, 3 = continuation of a
// wide glyph. opentui pools every non-ASCII glyph, Arabic included, so cell
// text is read back with getRealCharBytes. Pooled ids are reference counted:
// cells may be moved within a row, but a new glyph is only ever written with
// setCell/drawText, never by overwriting an id in the raw planes.
const PLAIN = 0
const POOLED = 2
const CONTINUATION = 3

// Glyphs of one row: a start cell plus its continuation cells, with the text
// it shows. The row text comes from the frame as grapheme clusters, one per
// start cell; null when the two disagree.
function rowUnits(char, rowStart, width, rowText) {
  const clusters = segmenter.segment(rowText)[Symbol.iterator]()
  const units = []
  for (let x = 0; x < width; x++) {
    const c = char[rowStart + x]
    const type = c >>> 30
    if (type === CONTINUATION && units.length > 0) {
      units[units.length - 1].len++
      continue
    }
    const next = clusters.next()
    if (next.done) return null
    const text = next.value.segment
    if (type === PLAIN && text.codePointAt(0) !== c) return null
    if (type !== PLAIN && type !== POOLED) return null
    units.push({ x, len: 1, text })
  }
  return units
}

// Turns rtl-core region plans into cell moves: ranges [offset, len] relative
// to the region's first cell, in visual order, and glyphs at visual offsets.
function planCells(char, rowStart, width, rowText, glyphs) {
  if (!rowText || !hasRtl(rowText)) return []
  const units = rowUnits(char, rowStart, width, rowText)
  if (!units) return []
  return planRow(units, { glyphs }).map(({ from, to, order, glyphs: swaps }) => {
    const x0 = units[from].x
    const x1 = units[to - 1].x + units[to - 1].len
    const moves = []
    const redraw = []
    let offset = 0
    for (const i of order) {
      moves.push([units[i].x - x0, units[i].len])
      if (swaps.has(i)) redraw.push([offset, swaps.get(i)])
      offset += units[i].len
    }
    return { x0, x1, moves, redraw }
  })
}

function applyRegion(buffer, RGBA, planes, strides, y, { x0, x1, moves, redraw }) {
  // Move the region's cells into visual order. Moving keeps every pooled id
  // in the frame exactly once, so reference counts stay balanced.
  const rowStart = y * buffer.width
  const saved = planes.map((plane, p) => plane.slice((rowStart + x0) * strides[p], (rowStart + x1) * strides[p]))
  let x = x0
  for (const [src, len] of moves) {
    for (let p = 0; p < planes.length; p++) {
      const s = strides[p]
      planes[p].set(saved[p].subarray(src * s, (src + len) * s), (rowStart + x) * s)
    }
    x += len
  }

  // New glyphs go through the checked drawing API, then the cell's exact
  // colours are restored from the raw planes.
  const [, fg, bg, attributes] = planes
  for (const [offset, glyph] of redraw) {
    const cx = x0 + offset
    const i = rowStart + cx
    const keepFg = fg.slice(i * strides[1], (i + 1) * strides[1])
    const keepBg = bg.slice(i * strides[2], (i + 1) * strides[2])
    const fgColor = RGBA.fromArray(keepFg)
    const bgColor = RGBA.fromArray(keepBg)
    if (glyph.length === 1) buffer.setCell(cx, y, glyph, fgColor, bgColor, attributes[i])
    else buffer.drawText(glyph, cx, y, fgColor, bgColor, attributes[i])
    fg.set(keepFg, i * strides[1])
    bg.set(keepBg, i * strides[2])
  }
}

// Row plans keyed by the row's raw cell values. Pooled ids carry a
// generation, so the same values mean the same glyphs; an unchanged row
// reuses its plan without reading the frame's text again.
const plans = new Map()
const PLAN_LIMIT = 512

function rowKey(char, start, width) {
  let h = 2166136261
  for (let i = start; i < start + width; i++) h = Math.imul(h ^ char[i], 16777619)
  return h >>> 0
}

function sameRow(saved, char, start, width) {
  for (let i = 0; i < width; i++) if (saved[i] !== char[start + i]) return false
  return true
}

function postProcess(buffer, RGBA) {
  const { char, fg, bg, attributes } = buffer.buffers
  const width = buffer.width
  const height = buffer.height
  const cells = width * height
  if (cells === 0) return

  // Arabic always arrives pooled, so only rows with pooled cells can hold it.
  const candidates = []
  for (let y = 0; y < height; y++) {
    const rowStart = y * width
    for (let x = 0; x < width; x++) {
      if (char[rowStart + x] >>> 30 !== POOLED) continue
      candidates.push(y)
      break
    }
  }
  if (candidates.length === 0) return

  const planes = [char, fg, bg, attributes]
  const strides = planes.map((plane) => plane.length / cells)
  const apply = (y, regionPlans) => {
    for (const plan of regionPlans) applyRegion(buffer, RGBA, planes, strides, y, plan)
  }

  // Rows seen before are fixed from their plan; the rest are planned from
  // the frame's text, read once, before any of them is changed.
  const fresh = []
  for (const y of candidates) {
    const key = rowKey(char, y * width, width)
    const known = plans.get(key)
    if (known && sameRow(known.chars, char, y * width, width)) apply(y, known.regions)
    else fresh.push([y, key])
  }
  if (fresh.length === 0) return

  if (plans.size > PLAN_LIMIT) plans.clear()
  const rows = decoder.decode(buffer.getRealCharBytes(true)).split("\n")
  const planned = fresh.map(([y, key]) => {
    const chars = char.slice(y * width, (y + 1) * width)
    const regionPlans = planCells(char, y * width, width, rows[y], RGBA !== undefined)
    plans.set(key, { chars, regions: regionPlans })
    return [y, regionPlans]
  })
  for (const [y, regionPlans] of planned) apply(y, regionPlans)
}

export default {
  id: "agent-rtl",
  async setup(api) {
    if (process.env.OPENCODE_ARABIC_RTL === "0") return
    // RGBA comes from the host's own opentui; without it rows are still
    // reordered, just not shaped.
    const RGBA = await import("@opentui/core").then((m) => m.RGBA).catch(() => undefined)
    const run = (buffer) => {
      try {
        postProcess(buffer, RGBA)
      } catch {
        // A frame that cannot be fixed is drawn as opencode painted it.
      }
    }
    api.renderer.addPostProcessFn(run)
    return () => api.renderer.removePostProcessFn(run)
  },
}
