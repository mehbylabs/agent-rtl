// Shared right-to-left engine for agent-rtl.
//
// Terminal UIs lay text out left to right, one glyph per cell, so Arabic,
// Persian and Hebrew show reversed and Arabic letters show disconnected.
// planRow() takes one screen row as glyphs in painted order and says how to
// repaint it: the visual order of each RTL region (Unicode Bidirectional
// Algorithm, via bidi-js) and the glyphs to swap in (Arabic Presentation
// Forms for joined letters, mirrored brackets). Swaps are one glyph for one
// glyph, so widths never change; lam-alef ligatures are skipped for that
// reason.

import bidiFactory from "./bidi.mjs"

const bidi = bidiFactory()

// Placeholder for glyphs that are not a single BMP code point; bidi-js
// treats U+FFFC as a neutral, so it follows the direction around it.
const OBJECT = "￼"

// A row splits into independent regions at box-drawing characters and at
// gaps of this many spaces (padding between panels, sidebars and borders).
const GAP = 3

// Arabic letter -> [isolated, final, initial, medial]. Right-joining letters
// have only isolated/final; hamza has only isolated. Tatweel joins both sides.
const FORMS = {
  0x0621: [0xfe80],
  0x0622: [0xfe81, 0xfe82],
  0x0623: [0xfe83, 0xfe84],
  0x0624: [0xfe85, 0xfe86],
  0x0625: [0xfe87, 0xfe88],
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c],
  0x0627: [0xfe8d, 0xfe8e],
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  0x0629: [0xfe93, 0xfe94],
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c],
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0],
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4],
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8],
  0x062f: [0xfea9, 0xfeaa],
  0x0630: [0xfeab, 0xfeac],
  0x0631: [0xfead, 0xfeae],
  0x0632: [0xfeaf, 0xfeb0],
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8],
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc],
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0],
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4],
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8],
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc],
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0],
  0x0640: [0x0640, 0x0640, 0x0640, 0x0640],
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4],
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8],
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc],
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0],
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4],
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec],
  0x0648: [0xfeed, 0xfeee],
  0x0649: [0xfeef, 0xfef0],
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4],
  0x0671: [0xfb50, 0xfb51],
  0x067e: [0xfb56, 0xfb57, 0xfb58, 0xfb59],
  0x0686: [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d],
  0x0698: [0xfb8a, 0xfb8b],
  0x06a9: [0xfb8e, 0xfb8f, 0xfb90, 0xfb91],
  0x06af: [0xfb92, 0xfb93, 0xfb94, 0xfb95],
  0x06cc: [0xfbfc, 0xfbfd, 0xfbfe, 0xfbff],
}

export function isRtl(cp) {
  return (cp >= 0x0590 && cp <= 0x08ff) || (cp >= 0xfb1d && cp <= 0xfdff) || (cp >= 0xfe70 && cp <= 0xfefc)
}

export function hasRtl(text) {
  for (const c of text) if (isRtl(c.codePointAt(0))) return true
  return false
}

function isFrame(cp) {
  return cp >= 0x2500 && cp <= 0x259f
}

const base = (unit) => unit.text.codePointAt(0) ?? 0x20

// Technical tokens that must stay left to right as one piece: URLs, paths
// (./install.sh, src/core/x.mjs), dotted names and versions, and flags. Their
// slashes and dots are neutral in UAX #9 and would otherwise drift to the RTL
// side. Sentence punctuation after a token stays outside it.
const LTR_TOKEN = /(?:https?:\/\/|www\.)\S+|[~.]{0,2}\/?[\w@~-]*\/[\w@.\/~-]*|[\w@-]+(?:\.[\w@-]+)+|--?[A-Za-z][\w-]*/g

function pinLtrTokens(text) {
  return text.replace(LTR_TOKEN, (token) => {
    const core = token.replace(/[.,:;!?]+$/, "")
    return "a".repeat(core.length) + token.slice(core.length)
  })
}

// A UI marker that opens a region (prompt arrow, bullet, dash) followed by a
// space stays where the host drew it instead of moving to the RTL end.
// Brackets are not markers: they belong to the text.
const MARKER = /^[\p{S}\p{Pd}\p{Po}\p{Pi}\p{Pf}]$/u

function skipMarker(units, cps, from, to) {
  if (to - from < 3 || cps[from + 1] !== 0x20 || !MARKER.test(units[from].text)) return from
  from += 2
  while (from < to && cps[from] === 0x20) from++
  return from
}

// [from, to) glyph ranges, trimmed of edge spaces.
function regions(cps) {
  const out = []
  let from = -1
  let last = -1
  let spaces = 0
  const close = () => {
    if (from !== -1) out.push([from, last + 1])
    from = -1
  }
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i]
    if (isFrame(cp)) {
      close()
      spaces = 0
    } else if (cp === 0x20) {
      if (++spaces === GAP) close()
    } else {
      if (from === -1) from = i
      last = i
      spaces = 0
    }
  }
  close()
  return out
}

// Joined form of each Arabic letter, from its neighbours in logical order.
// Marks that share the letter's cell (tashkeel) are kept after it.
function shape(units, cps, from, to, glyphs) {
  for (let i = from; i < to; i++) {
    const forms = FORMS[cps[i]]
    if (!forms) continue
    const prev = i > from ? FORMS[cps[i - 1]] : undefined
    const next = i + 1 < to ? FORMS[cps[i + 1]] : undefined
    const joinsPrev = prev?.length === 4
    const joinsNext = forms.length === 4 && (next?.length ?? 0) > 1
    const form = joinsPrev && joinsNext ? 3 : joinsNext ? 2 : joinsPrev && forms.length > 1 ? 1 : 0
    const marks = units[i].text.slice(String.fromCodePoint(cps[i]).length)
    glyphs.set(i, String.fromCodePoint(forms[form]) + marks)
  }
}

/**
 * Plans one screen row.
 * @param {{ text: string }[]} units glyphs in painted order; empty text = blank
 * @param {{ glyphs?: boolean }} options glyphs: false keeps every glyph as is
 *   (reorder only), for hosts that cannot draw new glyphs
 * @returns {{ from: number, to: number, order: number[], glyphs: Map<number, string> }[]}
 *   one entry per region that holds RTL text: `order` lists the glyph indices
 *   from..to-1 in left-to-right visual order, `glyphs` maps a glyph index to
 *   the text to draw in its place
 */
export function planRow(units, { glyphs: swap = true } = {}) {
  const cps = units.map(base)
  const plans = []
  for (const [start, to] of regions(cps)) {
    const from = skipMarker(units, cps, start, to)
    let rtl = false
    for (let i = from; i < to && !rtl; i++) rtl = isRtl(cps[i])
    if (!rtl) continue

    // bidi-js works per UTF-16 unit, so every glyph is one unit: its base
    // letter when that is a BMP code point, a neutral placeholder otherwise.
    let text = ""
    for (let i = from; i < to; i++) text += cps[i] <= 0xffff ? String.fromCharCode(cps[i]) : OBJECT
    text = pinLtrTokens(text)
    const levels = bidi.getEmbeddingLevels(text, "auto")
    const order = Array.from({ length: to - from }, (_, i) => from + i)
    for (const [a, b] of bidi.getReorderSegments(text, levels)) {
      for (let i = a, j = b; i < j; i++, j--) [order[i], order[j]] = [order[j], order[i]]
    }

    const glyphs = new Map()
    if (swap) {
      shape(units, cps, from, to, glyphs)
      for (let i = from; i < to; i++) {
        if (glyphs.has(i) || !(levels.levels[i - from] & 1) || units[i].text.length !== 1) continue
        const mirrored = bidi.getMirroredCharacter(units[i].text)
        if (mirrored) glyphs.set(i, mirrored)
      }
    }
    plans.push({ from, to, order, glyphs })
  }
  return plans
}
