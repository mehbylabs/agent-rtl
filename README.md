<p align="center">
  <img src="docs/assets/hero.jpg" alt="agent-rtl: right-to-left Arabic, Persian and Hebrew for terminal coding agents" width="100%">
</p>

<p align="center">
  <b>Right-to-left Arabic, Persian and Hebrew in terminal coding agents</b><br>
  Claude Code · opencode · Codex · agy (Antigravity CLI)
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#how-each-agent-is-fixed">How it works</a> ·
  <a href="#terminal-settings">Terminal settings</a> ·
  <a href="#known-limits">Limits</a>
</p>

Terminal UIs lay text out left to right and draw one letter per cell. So
`مرحبا بالعالم` shows reversed, with every letter in its standalone shape.
agent-rtl repaints each screen row that holds RTL text:

<p align="center">
  <img src="docs/assets/before-after.png" alt="Before: Arabic in a terminal shows reversed with disconnected letters. After: with agent-rtl it reads right to left with joined letters, while opencode, Codex, src/core/rtl-core.mjs and ./install.sh stay left to right." width="100%">
</p>

- **Right to left:** RTL text reads right to left (Unicode Bidirectional
  Algorithm, UAX #9).
- **Joined letters:** each Arabic letter takes its start, middle, end or
  standalone shape from the letters next to it.
- **Technical text stays intact:** English words, commands, paths
  (`./install.sh`, `src/core/rtl-core.mjs`), URLs, flags and numbers inside
  Arabic stay left to right and in one piece.
- **UI details:** brackets are mirrored, and prompt markers (`›`, `>`, `•`)
  stay on the left.

Only what's drawn changes. What you type, copy/paste, and what the model reads
keep the original text.

## Install

```bash
git clone https://github.com/mehbylabs/agent-rtl.git && cd agent-rtl
./install.sh
```

The installer shows which agents are installed here and asks what to set up:

```
Install for:
  1) All installed agents (claude opencode codex agy)
  2) Claude Code                      [installed]
  3) opencode                         [installed]
  4) Codex (wrapper, experimental)    [installed]
  5) agy (wrapper, experimental)      [installed]
Choose (e.g. 1, or 3 4):
```

Or skip the menu:

```bash
./install.sh --all            # every agent found, asks a few yes/no questions
./install.sh --all -y         # same, no questions
./install.sh opencode codex   # specific agents
./install.sh --uninstall agy  # remove from one agent
./install.sh --help
```

After installing:

| Agent | Next step |
|---|---|
| Claude Code | Restart Claude Code. |
| opencode | Close all opencode windows, then run `opencode service restart`. |
| Codex, agy | Open a new shell. `codex` and `agy` now run through agent-rtl. If you used `--no-alias`, run `agent-rtl codex` instead. |

Requirements: bash, plus Node.js 20+ for the Codex/agy wrapper. Claude Code
needs version 2.1.287 or newer.

## How each agent is fixed

| Agent | How | Survives agent updates |
|---|---|---|
| **Claude Code** | Installs the [claude-code-cli-rtl](https://github.com/ofekbetzalel/claude-code-cli-rtl) mod with Claude Code's own `claude plugin` commands, and sets `arabic` to `forms` (`letters` in Windows Terminal, which joins letters itself). | Yes (official mod API) |
| **opencode** | A TUI plugin copied to `~/.config/opencode/plugins/agent-rtl/`. It hooks `renderer.addPostProcessFn`, which runs on every finished frame before it reaches the terminal, and repaints the RTL rows. | Yes (official plugin API) |
| **Codex, agy** | Neither has a plugin hook into its screen, so the `agent-rtl` wrapper runs the **official** CLI inside a virtual terminal (xterm.js headless) and repaints each changed row into your real terminal. Lines that scroll off go into your real scrollback. Mouse, paste, alternate-screen and keyboard modes are passed through. | Yes (the CLI itself is not touched) |

Tested on Linux (ARM64) on 2026-10-30, by typing Arabic into each agent's
prompt, and by reading a real Arabic reply in agy:

| Agent | Version | Result |
|---|---|---|
| Claude Code | 2.1.314 | Right-aligned joined preview above the prompt (the mod's design) |
| opencode | 2.2.2 | Prompt and chat history repainted |
| Codex | 0.58.0 | Prompt repainted; scrollback kept |
| agy | 1.4.11 | Prompt and model replies repainted |

For Codex and agy, the installer can add a managed block to your shell rc
(`~/.zshrc` or `~/.bashrc`) so the plain command goes through the wrapper:

```bash
# >>> agent-rtl >>>
codex() { "$HOME/.local/bin/agent-rtl" codex "$@"; }
agy() { "$HOME/.local/bin/agent-rtl" agy "$@"; }
# <<< agent-rtl <<<
```

`./install.sh --uninstall codex agy` removes the block. `AGENT_RTL=0 codex`
runs the CLI once without the wrapper.

## Terminal settings

- **Turn off your terminal's own bidi/RTL option** (Konsole: *Bi-Directional
  text rendering*; mintty: `Bidi=0`; WezTerm: `bidi_enabled = false`, which is
  the default). Otherwise the text gets reordered twice.
- Use a font that has Arabic Presentation Forms (most do, for example DejaVu
  Sans Mono or Cascadia Code). If you see boxes, switch fonts.

## Known limits

- لا is drawn as lam followed by alef (ﻟﺎ), not the single ﻻ ligature, because
  the ligature would need two cells drawn as one.
- The text cursor sits where the agent thinks it is (logical position), not
  under the reordered letters.
- RTL lines are not pushed to the right edge.
- Wrapper (Codex, agy): experimental. Mouse clicks on reordered RTL text land
  on the logical position. Terminal colour queries are answered by the virtual
  terminal (dark theme).

## Layout

```
core/rtl-core.mjs        shared engine: regions, bidi reorder, Arabic joining, mirroring
core/bidi.mjs            bidi-js 1.1.0 (MIT, vendored unmodified)
agents/opencode/tui.js   opencode TUI plugin (installed with core/*)
wrapper/bin/agent-rtl.mjs  Codex / agy wrapper (node-pty + @xterm/headless)
install.sh               installer / uninstaller
test/                    npm test: core unit tests + sandboxed installer test
docs/assets/             README images
```

## Development

```bash
npm test                      # core tests + installer test in a throwaway HOME
```

## Credits

- [bidi-js](https://github.com/lojjic/bidi-js) by Jason Johnston (MIT), the
  Unicode Bidirectional Algorithm.
- [claude-code-cli-rtl](https://github.com/ofekbetzalel/claude-code-cli-rtl) by
  Ofek Betzalel, the Claude Code mod that agent-rtl installs, and the model for
  the opencode plugin.
