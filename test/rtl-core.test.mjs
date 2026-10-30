import { test } from "node:test"
import assert from "node:assert/strict"
import { hasRtl, planRow } from "../core/rtl-core.mjs"

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

// Paints a row the way a terminal would after planning: visual order, swaps.
function paint(text, options) {
  const units = [...segmenter.segment(text)].map((s) => ({ text: s.segment }))
  const out = units.map((u) => u.text)
  for (const { from, order, glyphs } of planRow(units, options)) {
    order.forEach((i, k) => (out[from + k] = glyphs.get(i) ?? units[i].text))
  }
  return out.join("")
}

const hex = (s) => [...s].map((c) => c.codePointAt(0).toString(16).toUpperCase())

test("Arabic letters join and read right to left", () => {
  // مرحبا: meem initial, reh final, hah initial (reh never joins forward),
  // beh medial, alef final; painted right to left.
  assert.deepEqual(hex(paint("مرحبا")), ["FE8E", "FE92", "FEA3", "FEAE", "FEE3"])
})

test("hamza never joins and tashkeel stays on its letter", () => {
  assert.deepEqual(hex(paint("ءامن")), ["FEE6", "FEE3", "FE8D", "FE80"])
  assert.deepEqual(hex(paint("شغّل")), ["FEDE", "FED0", "651", "FEB7"])
})

test("English, commands and paths stay left to right inside Arabic", () => {
  const painted = paint("شغل npm install ثم src/index.ts").normalize("NFKC")
  assert.equal(painted, "src/index.ts مث npm install لغش")
})

test("paths, URLs, flags and versions stay whole and left to right", () => {
  assert.equal(paint("شغّل ./install.sh الآن").normalize("NFKC"), "نآلا ./install.sh لغّش")
  assert.equal(paint("الملف هو src/core/rtl-core.mjs.").normalize("NFKC"), ".src/core/rtl-core.mjs وه فلملا")
  assert.equal(paint("افتح https://github.com/mehbylabs الآن").normalize("NFKC"), "نآلا https://github.com/mehbylabs حتفا")
  assert.equal(paint("استخدم --no-alias هنا").normalize("NFKC"), "انه --no-alias مدختسا")
})

test("brackets mirror in RTL runs", () => {
  assert.equal(paint("(تجربة)").normalize("NFKC"), "(ةبرجت)")
})

test("an English-led line keeps its order and reverses only the Arabic run", () => {
  assert.equal(paint("hello مرحبا world").normalize("NFKC"), "hello ابحرم world")
})

test("panels split at box drawing and wide gaps", () => {
  const painted = paint("│ مرحبا │ sidebar     نعم").normalize("NFKC")
  assert.equal(painted, "│ ابحرم │ sidebar     معن")
})

test("a leading prompt marker or bullet stays on the left", () => {
  assert.equal(paint("› مرحبا بالعالم").normalize("NFKC"), "› ملاعلاب ابحرم")
  assert.equal(paint("> مرحبا").normalize("NFKC"), "> ابحرم")
  assert.equal(paint("• نعم").normalize("NFKC"), "• معن")
  assert.equal(paint("(نعم) لا").normalize("NFKC"), "ال (معن)")
  assert.equal(paint("## ١. فقرات").normalize("NFKC"), "## تارقف .١")
})

test("Urdu and Maghrebi letters join too", () => {
  // یہ: farsi yeh initial, heh goal final; ڤي: veh initial, yeh final.
  assert.deepEqual(hex(paint("یہ")), ["FBA7", "FBFE"])
  assert.deepEqual(hex(paint("ڤي")), ["FEF2", "FB6C"])
})

test("rows without RTL are left alone", () => {
  assert.equal(hasRtl("plain english row"), false)
  assert.equal(planRow([..."plain"].map((text) => ({ text }))).length, 0)
})

test("glyphs: false reorders without swapping glyphs, brackets included", () => {
  assert.equal(paint("مرحبا (نعم)", { glyphs: false }), ")معن( ابحرم")
})
