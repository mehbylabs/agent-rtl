#!/usr/bin/env bash
# Installs agent-rtl into a throwaway home (config, data, bin and shell rc all
# inside it) the way npx does, from bin/agent-rtl.mjs, and checks install,
# status, the upgrade from plugins/arabic-rtl, and uninstall through the
# installed agent-rtl command. Claude Code is left out: it changes the real
# claude setup.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

export HOME="$SANDBOX" SHELL=/bin/zsh ZDOTDIR="$SANDBOX" AGENT_RTL_RC="$SANDBOX/.zshrc"
export XDG_CONFIG_HOME="$SANDBOX/.config" XDG_DATA_HOME="$SANDBOX/.local/share" AGENT_RTL_BIN="$SANDBOX/bin"
unset AGENT_RTL_HOME
installed_home="$XDG_DATA_HOME/agent-rtl"

plugins="$XDG_CONFIG_HOME/opencode/plugins"
mkdir -p "$plugins/arabic-rtl"
echo 'export default { id: "arabic-rtl" }' >"$plugins/arabic-rtl/tui.js"
echo 'export KEEP=1' >"$AGENT_RTL_RC"

fail() { echo "FAIL: $*" >&2; exit 1; }
npx_like() { node "$REPO/bin/agent-rtl.mjs" "$@" >/dev/null 2>&1 || fail "agent-rtl $*"; }
installed() { "$AGENT_RTL_BIN/agent-rtl" "$@" >/dev/null 2>&1 || fail "installed agent-rtl $*"; }

npx_like install opencode codex agy -y
[ -f "$plugins/agent-rtl/tui.js" ] && [ -f "$plugins/agent-rtl/rtl-core.mjs" ] || fail "opencode plugin missing"
[ ! -e "$plugins/arabic-rtl" ] || fail "old arabic-rtl plugin not replaced"
[ "$(readlink "$AGENT_RTL_BIN/agent-rtl")" = "$installed_home/bin/agent-rtl.mjs" ] || fail "agent-rtl not linked to the installed copy"
[ -d "$installed_home/wrapper/node_modules/@xterm/headless" ] || fail "wrapper dependencies missing"
[ "$(sort "$installed_home/.installed" | tr '\n' ' ')" = "agy codex opencode " ] || fail "installed list: $(cat "$installed_home/.installed")"
grep -q '^codex() ' "$AGENT_RTL_RC" && grep -q '^agy() ' "$AGENT_RTL_RC" || fail "shell functions missing"
grep -q '^export KEEP=1$' "$AGENT_RTL_RC" || fail "rc content lost"
status_out="$("$AGENT_RTL_BIN/agent-rtl" status)"
grep -q "opencode .*installed" <<<"$status_out" && grep -q "agy .*runs through agent-rtl" <<<"$status_out" || fail "status: $status_out"

installed install codex -y
[ "$(grep -c '>>> agent-rtl >>>' "$AGENT_RTL_RC")" = 1 ] || fail "block duplicated on reinstall"
[ "$(grep -cx codex "$installed_home/.installed")" = 1 ] || fail "codex recorded twice"

installed uninstall codex -y
! grep -q '^codex() ' "$AGENT_RTL_RC" && grep -q '^agy() ' "$AGENT_RTL_RC" || fail "uninstall codex"
[ -L "$AGENT_RTL_BIN/agent-rtl" ] || fail "agent-rtl removed while agents remain"

installed uninstall agy opencode -y
! grep -q 'agent-rtl' "$AGENT_RTL_RC" || fail "block left after last uninstall"
[ ! -e "$AGENT_RTL_BIN/agent-rtl" ] || fail "agent-rtl command left"
[ ! -e "$installed_home" ] || fail "installed copy left"
[ ! -e "$plugins/agent-rtl" ] || fail "opencode plugin left"
[ "$(cat "$AGENT_RTL_RC")" = 'export KEEP=1' ] || fail "rc not restored exactly"

echo "install.test.sh: all checks passed"
