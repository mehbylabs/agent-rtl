#!/usr/bin/env node
// agent-rtl wrapper: runs a terminal agent CLI (Codex, agy, ...) with
// right-to-left Arabic, Persian and Hebrew fixed on screen.
//
//   agent-rtl <command> [args...]
//
// The CLI runs in a pseudo-terminal whose output feeds a headless xterm.js
// terminal. Each changed row of that virtual screen is repainted into the
// real terminal, with RTL regions reordered and Arabic letters joined by
// rtl-core. Lines the virtual screen scrolls off are written into the real
// terminal's scrollback, so inline UIs (Codex) keep their history. Terminal
// modes the CLI turns on (mouse, bracketed paste, alternate screen, cursor
// keys, kitty keyboard, cursor shape) and title, clipboard and notification
// requests are passed through; keyboard input goes straight to the CLI.
// Use it with a terminal whose own bidi option is off.

import { spawn as spawnChild } from "node:child_process"
import { StringDecoder } from "node:string_decoder"
import pty from "@lydell/node-pty"
import headless from "@xterm/headless"
import { hasRtl, planRow } from "../../core/rtl-core.mjs"

const { Terminal } = headless

const [command, ...args] = process.argv.slice(2)
if (!command || command === "--help" || command === "-h") {
  process.stderr.write("usage: agent-rtl <command> [args...]\n  e.g. agent-rtl codex, agent-rtl agy\n")
  process.exit(command ? 0 : 2)
}

// Nested runs, pipes and AGENT_RTL=0 run the command untouched.
if (!process.stdin.isTTY || !process.stdout.isTTY || process.env.AGENT_RTL === "0" || process.env.AGENT_RTL_ACTIVE) {
  const child = spawnChild(command, args, { stdio: "inherit" })
  child.on("error", (error) => {
    process.stderr.write(`agent-rtl: ${command}: ${error.message}\n`)
    process.exit(127)
  })
  child.on("exit", (code, signal) => process.exit(signal ? 128 : (code ?? 0)))
} else {
  run()
}

function run() {
  const out = process.stdout
  let cols = out.columns || 80
  let rows = out.rows || 24

  const term = new Terminal({ cols, rows, scrollback: 10000, allowProposedApi: true })
  let child
  try {
    child = pty.spawn(command, args, {
      name: process.env.TERM || "xterm-256color",
      cols,
      rows,
      cwd: process.cwd(),
      env: { ...process.env, AGENT_RTL_ACTIVE: "1" },
    })
  } catch (error) {
    process.stderr.write(`agent-rtl: ${command}: ${error.message}\n`)
    process.exit(127)
  }

  // Sequences for the real terminal, flushed ahead of the next repaint so
  // they land in order with the screen they belong to.
  let forward = ""
  const enabled = new Set()
  let kittyPushes = 0
  let cursorVisible = true
  let syncing = false

  const paramsText = (params) => params.map((p) => (Array.isArray(p) ? p.join(":") : p)).join(";")

  // DEC private modes the real terminal must share with the CLI. Cursor
  // visibility (25) and synchronized output (2026) are handled here instead.
  const SHARED_MODES = new Set([1, 9, 12, 47, 1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1015, 1016, 1047, 1049, 2004, 2031])
  const ALT_MODES = new Set([47, 1047, 1049])
  const decMode = (on) => (params) => {
    for (const param of params) {
      const mode = Array.isArray(param) ? param[0] : param
      if (mode === 25) cursorVisible = on
      else if (mode === 2026) {
        syncing = on
        if (!on) schedule()
      } else if (SHARED_MODES.has(mode)) {
        forward += `\x1b[?${mode}${on ? "h" : "l"}`
        if (on) enabled.add(mode)
        else enabled.delete(mode)
        if (ALT_MODES.has(mode)) repaintAll = true
      }
    }
    return false
  }
  term.parser.registerCsiHandler({ prefix: "?", final: "h" }, decMode(true))
  term.parser.registerCsiHandler({ prefix: "?", final: "l" }, decMode(false))

  // Kitty keyboard protocol push/pop/set and cursor shape (DECSCUSR).
  term.parser.registerCsiHandler({ prefix: ">", final: "u" }, (params) => {
    forward += `\x1b[>${paramsText(params)}u`
    kittyPushes++
    return true
  })
  term.parser.registerCsiHandler({ prefix: "<", final: "u" }, (params) => {
    forward += `\x1b[<${paramsText(params)}u`
    kittyPushes = Math.max(0, kittyPushes - (Number(params[0]) || 1))
    return true
  })
  term.parser.registerCsiHandler({ prefix: "=", final: "u" }, (params) => {
    forward += `\x1b[=${paramsText(params)}u`
    return true
  })
  term.parser.registerCsiHandler({ intermediates: " ", final: "q" }, (params) => {
    forward += `\x1b[${paramsText(params)} q`
    return false
  })
  term.parser.registerEscHandler({ final: "=" }, () => {
    forward += "\x1b="
    return false
  })
  term.parser.registerEscHandler({ final: ">" }, () => {
    forward += "\x1b>"
    return false
  })

  // Title, clipboard and notifications.
  for (const ident of [0, 1, 2, 9, 52, 777]) {
    term.parser.registerOscHandler(ident, (data) => {
      forward += `\x1b]${ident};${data}\x07`
      return false
    })
  }
  term.onBell(() => (forward += "\x07"))

  // Replies the virtual terminal gives to the CLI's queries (cursor
  // position, device attributes, colours) go back to the CLI.
  term.onData((data) => child.write(data))
  term.onBinary((data) => child.write(data))

  // Repainting.
  const cell = term.buffer.active.getNullCell()
  let painted = []
  let repaintAll = true
  let lastBuffer = term.buffer.active.type
  let lastBaseY = 0
  let timer = null
  let syncSince = 0

  function sgr(c) {
    let s = "0"
    if (c.isBold()) s += ";1"
    if (c.isDim()) s += ";2"
    if (c.isItalic()) s += ";3"
    if (c.isUnderline()) s += ";4"
    if (c.isBlink()) s += ";5"
    if (c.isInverse()) s += ";7"
    if (c.isInvisible()) s += ";8"
    if (c.isStrikethrough()) s += ";9"
    if (c.isOverline()) s += ";53"
    s += color(c.isFgRGB(), c.isFgPalette(), c.getFgColor(), 30, 90, 38)
    s += color(c.isBgRGB(), c.isBgPalette(), c.getBgColor(), 40, 100, 48)
    return s
  }

  function color(rgb, palette, value, low, high, extended) {
    if (rgb) return `;${extended};2;${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}`
    if (!palette) return ""
    if (value < 8) return `;${low + value}`
    if (value < 16) return `;${high + value - 8}`
    return `;${extended};5;${value}`
  }

  // One buffer line as an escape string, RTL regions repainted.
  function line(y) {
    const bufferLine = term.buffer.active.getLine(y)
    if (!bufferLine) return `\x1b[0m${" ".repeat(cols)}`
    const units = []
    for (let x = 0; x < cols; x++) {
      bufferLine.getCell(x, cell)
      const width = cell.getWidth()
      if (width === 0) continue
      units.push({ text: cell.getChars() || " ", style: sgr(cell) })
    }
    let visual = units
    if (hasRtl(bufferLine.translateToString(true))) {
      visual = units.slice()
      for (const { from, order, glyphs } of planRow(units)) {
        order.forEach((i, k) => {
          const text = glyphs.get(i) ?? units[i].text
          visual[from + k] = { text, style: units[i].style }
        })
      }
    }
    let s = ""
    let style = ""
    for (const unit of visual) {
      if (unit.style !== style) s += `\x1b[${(style = unit.style)}m`
      s += unit.text
    }
    return `${s}\x1b[0m`
  }

  function paint() {
    timer = null
    if (syncing && Date.now() - syncSince < 200) return schedule()
    const buffer = term.buffer.active
    // Autowrap stays off while repainting: a glyph the real terminal draws
    // wider than xterm.js measured (some emoji) must not wrap a full row and
    // scroll the screen, which would shift every line after it.
    let s = "\x1b[?2026h\x1b[?25l\x1b[?7l" + forward
    forward = ""

    if (buffer.type !== lastBuffer) {
      lastBuffer = buffer.type
      repaintAll = true
    } else if (buffer.type === "normal" && buffer.baseY > lastBaseY && !repaintAll) {
      // Lines that left the top of the virtual screen go to the real
      // scrollback. The real screen is first repainted with the lines from
      // the old top; then each newline on the bottom row pushes the real top
      // row out, and the freed bottom row takes the next line.
      for (let y = 0; y < rows; y++) s += `\x1b[${y + 1};1H${line(lastBaseY + y)}`
      for (let y = lastBaseY + rows; y < buffer.baseY + rows; y++) {
        s += `\x1b[${rows};1H\n\x1b[${rows};1H\x1b[2K${line(y)}`
      }
      repaintAll = true
    }
    if (buffer.type === "normal") lastBaseY = buffer.baseY
    if (repaintAll) painted = []
    repaintAll = false

    for (let y = 0; y < rows; y++) {
      const text = line(buffer.baseY + y)
      if (painted[y] === text) continue
      painted[y] = text
      s += `\x1b[${y + 1};1H${text}`
    }
    s += `\x1b[${buffer.cursorY + 1};${buffer.cursorX + 1}H`
    if (cursorVisible) s += "\x1b[?25h"
    out.write(s + "\x1b[?7h\x1b[?2026l")
  }

  function schedule() {
    if (syncing && !syncSince) syncSince = Date.now()
    if (!syncing) syncSince = 0
    if (!timer) timer = setTimeout(paint, 16)
  }

  // Start on a clean screen: the shell's last screenful moves into the
  // scrollback, and the real terminal scrolls as one full region.
  out.write(`\x1b[r\x1b[${rows};1H${"\n".repeat(rows)}\x1b[H`)

  child.onData((data) => term.write(data, schedule))

  const input = new StringDecoder("utf8")
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on("data", (data) => child.write(input.write(data)))

  out.on("resize", () => {
    cols = out.columns
    rows = out.rows
    term.resize(cols, rows)
    child.resize(cols, rows)
    lastBaseY = term.buffer.active.baseY
    repaintAll = true
    schedule()
  })

  let finished = false
  function finish(code) {
    if (finished) return
    finished = true
    if (timer) clearTimeout(timer)
    syncing = false
    paint()
    const buffer = term.buffer.active
    let s = "\x1b[0m"
    for (const mode of enabled) if (!ALT_MODES.has(mode)) s += `\x1b[?${mode}l`
    if (kittyPushes > 0) s += `\x1b[<${kittyPushes}u`
    s += "\x1b[0 q\x1b>"
    if (buffer.type === "alternate") s += "\x1b[?1049l"
    else s += `\x1b[${buffer.cursorY + 1};${buffer.cursorX + 1}H`
    s += "\x1b[?25h"
    out.write(s)
    process.stdin.setRawMode(false)
    process.exit(code)
  }

  child.onExit(({ exitCode, signal }) => setTimeout(() => finish(signal ? 128 + signal : exitCode), 30))
  for (const sig of ["SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      child.kill(sig)
      finish(128)
    })
  }
}
