---
name: agent-rtl
description: Install, update, check or remove right-to-left Arabic, Persian and Hebrew display for terminal coding agents (Claude Code, opencode, Codex, agy). Use when Arabic, Persian, Urdu or Hebrew text shows reversed or with disconnected letters in a terminal agent, or when the user asks to install, update or uninstall agent-rtl.
---

# agent-rtl

agent-rtl repaints terminal agents so right-to-left text reads right to left
with joined Arabic letters, while English, paths and numbers stay left to
right. Everything runs through one command, from GitHub:

```bash
npx -y github:mehbylabs/agent-rtl <command>
```

Once installed, the same commands are available as `agent-rtl <command>`.

## Check first

```bash
agent-rtl status 2>/dev/null || npx -y github:mehbylabs/agent-rtl status
```

## Install

1. Ask the user whether to install for **all** their agents or **specific**
   ones (claude, opencode, codex, agy). Show which are installed:
   `command -v claude opencode codex agy`.
2. For Codex and agy, ask whether the plain `codex` / `agy` command should
   run through agent-rtl (the default), or only `agent-rtl codex` (add
   `--no-alias`).
3. Install, non-interactively:

   ```bash
   npx -y github:mehbylabs/agent-rtl install --all -y          # all agents found
   npx -y github:mehbylabs/agent-rtl install opencode codex -y # specific ones
   ```

4. Run `agent-rtl status` and report what it shows. Don't report success
   before status confirms it.
5. Tell the user what to restart:
   - Claude Code: restart Claude Code.
   - opencode: close its windows, then run `opencode service restart`.
   - Codex, agy: open a new shell.

## Update

```bash
agent-rtl update
```

This fetches the newest version from GitHub and reinstalls the same agents.
Then give the same restart steps as above.

## Uninstall

```bash
agent-rtl uninstall --all -y        # or: agent-rtl uninstall codex agy -y
```

## Notes

- Requires Node.js 20+ and bash (Linux, macOS, WSL).
- The terminal's own bidi/RTL option must stay off, or text is reordered
  twice.
- If letters show as boxes, the terminal font lacks Arabic Presentation Forms;
  suggest a font such as DejaVu Sans Mono.
- Don't edit agent config files by hand; the installer manages them, and
  `agent-rtl uninstall` reverses everything it changed.
