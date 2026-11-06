#!/usr/bin/env bash
# agent-rtl installer: right-to-left Arabic, Persian and Hebrew for terminal
# coding agents (Claude Code, opencode, Codex, agy). Usually run through
# `npx -y github:mehbylabs/agent-rtl`; ./install.sh --help for options.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENTS=(claude opencode codex agy)
BIN_DIR="${AGENT_RTL_BIN:-$HOME/.local/bin}"
# Where the agent-rtl command and the wrapper live once installed. npx runs
# this script from a temporary cache, so the runtime is copied here.
AGENT_RTL_HOME="${AGENT_RTL_HOME:-${XDG_DATA_HOME:-$HOME/.local/share}/agent-rtl}"
OPENCODE_PLUGINS="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins"
CLAUDE_MARKETPLACE_REPO="ofekbetzalel/claude-code-cli-rtl"
CLAUDE_MARKETPLACE="claude-code-cli-rtl"
CLAUDE_PLUGIN="rtl@claude-code-cli-rtl"
CLAUDE_MIN_VERSION="2.1.287"
BLOCK_START="# >>> agent-rtl >>>"
BLOCK_END="# <<< agent-rtl <<<"

uninstall=0
status=0
alias_wrapped=1
assume_yes=0
selected=()

usage() {
  cat <<EOF
Usage: ./install.sh [options] [agent...]

Agents: claude opencode codex agy. With no agent and no --all, a menu asks.

  --all          every agent found on this machine
  --uninstall    remove agent-rtl from the chosen agents
  --status       show which agents have agent-rtl
  --no-alias     codex/agy: only install the agent-rtl command; don't make
                 the plain 'codex' / 'agy' command run through it
  -y, --yes      no questions; take the defaults
  -h, --help     this help

Examples (npx -y github:mehbylabs/agent-rtl takes the same arguments
after 'install'):
  ./install.sh                  # menu
  ./install.sh --all -y         # everything installed here, no questions
  ./install.sh opencode         # one agent
  ./install.sh --uninstall codex agy
EOF
}

say() { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
have() { command -v "$1" >/dev/null 2>&1; }

label() {
  case "$1" in
    claude) echo "Claude Code" ;;
    opencode) echo "opencode" ;;
    codex) echo "Codex (wrapper, experimental)" ;;
    agy) echo "agy (wrapper, experimental)" ;;
  esac
}

# Yes/no question; default yes. -y answers yes.
confirm() {
  [ "$assume_yes" = 1 ] && return 0
  local answer
  read -r -p "  $1 [Y/n] " answer </dev/tty || return 0
  [[ -z "$answer" || "$answer" =~ ^[Yy] ]]
}

installed_agents() {
  local agent
  for agent in "${AGENTS[@]}"; do have "$agent" && echo "$agent"; done
}

menu() {
  local found
  found="$(installed_agents | paste -sd ' ' -)"
  say "agent-rtl: right-to-left Arabic, Persian and Hebrew for terminal agents"
  say ""
  if [ "$uninstall" = 1 ]; then say "Uninstall from:"; else say "Install for:"; fi
  say "  1) All installed agents (${found:-none found})"
  local i=2 agent state
  for agent in "${AGENTS[@]}"; do
    if have "$agent"; then state="installed"; else state="not found"; fi
    printf '  %d) %-32s [%s]\n' "$i" "$(label "$agent")" "$state"
    i=$((i + 1))
  done
  local choice
  read -r -p "Choose (e.g. 1, or 3 4): " choice </dev/tty
  for n in $choice; do
    case "$n" in
      1) read -r -a selected <<<"$found" ;;
      2 | 3 | 4 | 5) selected+=("${AGENTS[$((n - 2))]}") ;;
      *) warn "ignoring '$n'" ;;
    esac
  done
}

# ---- The installed copy: the agent-rtl command, the wrapper and this script,
# plus the list of agents set up, which `agent-rtl update` reinstalls.

runtime_ready=0
copy_runtime() {
  [ "$runtime_ready" = 1 ] && return
  runtime_ready=1
  [ "$(cd "$AGENT_RTL_HOME" 2>/dev/null && pwd)" = "$REPO" ] && return
  mkdir -p "$AGENT_RTL_HOME/wrapper"
  rm -rf "$AGENT_RTL_HOME/bin" "$AGENT_RTL_HOME/core" "$AGENT_RTL_HOME/agents" "$AGENT_RTL_HOME/wrapper/bin"
  cp -R "$REPO/bin" "$REPO/core" "$REPO/agents" "$REPO/install.sh" "$REPO/package.json" "$REPO/LICENSE" "$AGENT_RTL_HOME/"
  cp -R "$REPO/wrapper/bin" "$REPO/wrapper/package.json" "$REPO/wrapper/package-lock.json" "$AGENT_RTL_HOME/wrapper/"
  touch "$AGENT_RTL_HOME/.installed" "$AGENT_RTL_HOME/.agent-rtl-home"
}

installed_list() { cat "$AGENT_RTL_HOME/.installed" 2>/dev/null || true; }

record() {
  local action="$1" agent="$2" list
  list="$(installed_list | grep -vx "$agent" || true)"
  [ "$action" = add ] && list="$(printf '%s\n%s\n' "$list" "$agent")"
  [ -d "$AGENT_RTL_HOME" ] || return 0
  printf '%s\n' "$list" | awk 'NF' >"$AGENT_RTL_HOME/.installed"
}

# Once no agent is left, the installed copy goes too. Only a folder this
# script created (marked .agent-rtl-home) is removed, never a source checkout.
remove_runtime_if_unused() {
  [ -d "$AGENT_RTL_HOME" ] && [ -z "$(installed_list | awk 'NF')" ] || return 0
  [ -e "$AGENT_RTL_HOME/.agent-rtl-home" ] && [ ! -e "$AGENT_RTL_HOME/.git" ] || return 0
  rm -rf "$AGENT_RTL_HOME" && say "  removed $AGENT_RTL_HOME"
}

show_status() {
  say "agent-rtl status"
  local agent state
  for agent in "${AGENTS[@]}"; do
    case "$agent" in
      claude) claude plugin list 2>/dev/null | grep -q "$CLAUDE_PLUGIN" && state="installed" || state="-" ;;
      opencode) [ -e "$OPENCODE_PLUGINS/agent-rtl/.agent-rtl" ] && state="installed" || state="-" ;;
      codex | agy)
        if aliased_agents | grep -qx "$agent"; then state="installed ('$agent' runs through agent-rtl)"
        elif installed_list | grep -qx "$agent"; then state="installed (run: agent-rtl $agent)"
        else state="-"; fi ;;
    esac
    printf '  %-34s %s\n' "$(label "$agent")" "$state"
  done
  [ -d "$AGENT_RTL_HOME" ] && say "  files: $AGENT_RTL_HOME"
}

# ---- Claude Code: the claude-code-cli-rtl mod, installed with claude's own
# plugin commands so Claude Code keeps it updated.

version_at_least() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

install_claude() {
  step "Claude Code"
  have claude || { warn "claude not found; skipping"; return 1; }
  local version
  version="$(claude --version 2>/dev/null | awk '{print $1}')"
  if ! version_at_least "$version" "$CLAUDE_MIN_VERSION"; then
    warn "Claude Code $version is older than $CLAUDE_MIN_VERSION; run 'claude update' first"
    return 1
  fi
  claude plugin marketplace add "$CLAUDE_MARKETPLACE_REPO" >/dev/null 2>&1 || true
  claude plugin marketplace update "$CLAUDE_MARKETPLACE" >/dev/null
  if claude plugin list 2>/dev/null | grep -q "$CLAUDE_PLUGIN"; then
    claude plugin update "$CLAUDE_PLUGIN" >/dev/null || true
    claude plugin enable "$CLAUDE_PLUGIN" >/dev/null 2>&1 || true
  else
    claude plugin install "$CLAUDE_PLUGIN" >/dev/null
  fi
  # Joined Arabic letters are drawn by the mod (`forms`) everywhere except
  # Windows Terminal, which joins them itself (`letters`).
  local arabic=forms
  [ -n "${WT_SESSION:-}" ] && arabic=letters
  if confirm "Set Arabic letters to '$arabic' (recommended for this terminal)?"; then
    echo "{\"arabic\":\"$arabic\"}" | claude plugin configure "$CLAUDE_PLUGIN" --values-stdin >/dev/null
  fi
  claude plugin list 2>/dev/null | grep -A3 "$CLAUDE_PLUGIN" | grep -qi 'enabled' &&
    say "  installed $CLAUDE_PLUGIN (enabled)" || warn "check 'claude plugin list'"
  say "  restart Claude Code to load it"
}

uninstall_claude() {
  step "Claude Code"
  have claude || { warn "claude not found; skipping"; return; }
  if claude plugin list 2>/dev/null | grep -q "$CLAUDE_PLUGIN"; then
    claude plugin uninstall "$CLAUDE_PLUGIN" >/dev/null && say "  removed $CLAUDE_PLUGIN"
  else
    say "  not installed"
  fi
}

# ---- opencode: a TUI plugin in opencode's auto-discovered plugins folder.

install_opencode() {
  step "opencode"
  have opencode || warn "opencode not found; installing the plugin anyway"
  local target="$OPENCODE_PLUGINS/agent-rtl"
  mkdir -p "$target"
  cp "$REPO/agents/opencode/tui.js" "$REPO/core/rtl-core.mjs" "$REPO/core/bidi.mjs" "$REPO/core/LICENSE-bidi-js.txt" "$target/"
  echo "installed from $REPO" >"$target/.agent-rtl"
  # The plugin's first version lived in plugins/arabic-rtl.
  if grep -qs 'id: "arabic-rtl"' "$OPENCODE_PLUGINS/arabic-rtl/tui.js"; then
    rm -rf "$OPENCODE_PLUGINS/arabic-rtl"
    say "  replaced the older plugins/arabic-rtl"
  fi
  say "  installed $target"
  say "  close opencode windows, then run: opencode service restart"
}

uninstall_opencode() {
  step "opencode"
  local target="$OPENCODE_PLUGINS/agent-rtl"
  if [ -e "$target/.agent-rtl" ]; then
    rm -rf "$target" && say "  removed $target"
    say "  run 'opencode service restart' to unload it"
  else
    say "  not installed"
  fi
}

# ---- Codex and agy: the agent-rtl wrapper, plus an optional shell function
# so the plain command runs the official CLI through it.

rc_file() {
  [ -n "${AGENT_RTL_RC:-}" ] && { echo "$AGENT_RTL_RC"; return; }
  case "$(basename "${SHELL:-}")" in
    zsh) echo "${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash) echo "$HOME/.bashrc" ;;
    *) echo "" ;;
  esac
}

aliased_agents() {
  local rc
  rc="$(rc_file)"
  [ -n "$rc" ] && [ -f "$rc" ] || return 0
  sed -n "/^$BLOCK_START\$/,/^$BLOCK_END\$/p" "$rc" | sed -n 's/^\([a-z]*\)() {.*/\1/p'
}

# Rewrites the managed block in the shell rc with the given agents (or
# removes it when none are left).
write_block() {
  local rc
  rc="$(rc_file)"
  if [ -z "$rc" ]; then
    warn "unknown shell '${SHELL:-}'; add this yourself:"
    local agent
    for agent in "$@"; do warn "  $agent() { $BIN_DIR/agent-rtl $agent \"\$@\"; }"; done
    return
  fi
  touch "$rc"
  local tmp
  tmp="$(mktemp)"
  awk -v s="$BLOCK_START" -v e="$BLOCK_END" '$0 == s {skip = 1} !skip {print} $0 == e {skip = 0}' "$rc" >"$tmp"
  if [ "$#" -gt 0 ]; then
    {
      echo "$BLOCK_START"
      echo "# Run these agents through agent-rtl (right-to-left text). Managed by"
      echo "# agent-rtl: 'agent-rtl uninstall codex agy' removes it; AGENT_RTL=0 skips it once."
      local agent
      for agent in "$@"; do echo "$agent() { \"$BIN_DIR/agent-rtl\" $agent \"\$@\"; }"; done
      echo "$BLOCK_END"
    } >>"$tmp"
  fi
  cat "$tmp" >"$rc"
  rm -f "$tmp"
  say "  updated $rc (open a new shell to use it)"
}

# The agent-rtl command (update, status, uninstall, and the wrapper), linked
# into BIN_DIR from the installed copy.
link_command() {
  have node || { warn "Node.js 20+ is required for the agent-rtl command"; return 1; }
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 20 ] || { warn "Node.js $major found; agent-rtl needs 20+"; return 1; }
  mkdir -p "$BIN_DIR"
  chmod +x "$AGENT_RTL_HOME/bin/agent-rtl.mjs"
  ln -sf "$AGENT_RTL_HOME/bin/agent-rtl.mjs" "$BIN_DIR/agent-rtl"
  case ":$PATH:" in *":$BIN_DIR:"*) ;; *) warn "$BIN_DIR is not in PATH" ;; esac
}

wrapper_ready=0
install_wrapper_deps() {
  [ "$wrapper_ready" = 1 ] && return
  (cd "$AGENT_RTL_HOME/wrapper" && npm ci --omit=dev --no-audit --no-fund --silent)
  wrapper_ready=1
}

install_wrapped() {
  local agent="$1"
  step "$(label "$agent")"
  have "$agent" || warn "$agent not found; installing the wrapper anyway"
  install_wrapper_deps || return
  say "  run it with: agent-rtl $agent"
  if [ "$alias_wrapped" = 1 ] && confirm "Make the plain '$agent' command run through agent-rtl?"; then
    local agents
    mapfile -t agents < <({ aliased_agents; echo "$agent"; } | sort -u)
    write_block "${agents[@]}"
  fi
}

uninstall_wrapped() {
  local agent="$1"
  step "$(label "$agent")"
  local agents
  mapfile -t agents < <(aliased_agents | grep -vx "$agent" || true)
  write_block "${agents[@]}"
}

# ---- main

while [ "$#" -gt 0 ]; do
  case "$1" in
    --all) read -r -a selected <<<"$(installed_agents | tr '\n' ' ')" ;;
    --uninstall) uninstall=1 ;;
    --status) status=1 ;;
    --no-alias) alias_wrapped=0 ;;
    -y | --yes) assume_yes=1 ;;
    -h | --help) usage; exit 0 ;;
    claude | opencode | codex | agy) selected+=("$1") ;;
    *) warn "unknown option '$1'"; usage; exit 2 ;;
  esac
  shift
done

[ "$status" = 1 ] && { show_status; exit 0; }
[ "${#selected[@]}" -eq 0 ] && menu
[ "${#selected[@]}" -eq 0 ] && { say "Nothing chosen."; exit 0; }

mapfile -t selected < <(printf '%s\n' "${selected[@]}" | awk '!seen[$0]++')
if [ "$uninstall" = 0 ]; then
  copy_runtime
  link_command || exit 1
fi
for agent in "${selected[@]}"; do
  if [ "$uninstall" = 1 ]; then
    case "$agent" in
      claude) uninstall_claude ;;
      opencode) uninstall_opencode ;;
      codex | agy) uninstall_wrapped "$agent" ;;
    esac
    record remove "$agent"
  else
    case "$agent" in
      claude) install_claude ;;
      opencode) install_opencode ;;
      codex | agy) install_wrapped "$agent" ;;
    esac && record add "$agent"
  fi
done

step "Done"
if [ "$uninstall" = 1 ]; then
  if [ -z "$(installed_list | awk 'NF')" ]; then
    [ -L "$BIN_DIR/agent-rtl" ] && rm -f "$BIN_DIR/agent-rtl" && say "  removed $BIN_DIR/agent-rtl"
    remove_runtime_if_unused
  fi
else
  say "Update later with: agent-rtl update"
  say "Keep your terminal's own bidi/RTL option off; agent-rtl does the reordering."
fi
