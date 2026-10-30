#!/usr/bin/env bash
# Runs install.sh against a throwaway home (config, bin and shell rc all
# inside it) and checks install, upgrade from plugins/arabic-rtl, and
# uninstall. Claude Code is left out: it changes the real claude setup.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

export HOME="$SANDBOX" SHELL=/bin/zsh ZDOTDIR="$SANDBOX" AGENT_RTL_RC="$SANDBOX/.zshrc"
export XDG_CONFIG_HOME="$SANDBOX/.config" AGENT_RTL_BIN="$SANDBOX/bin"

plugins="$XDG_CONFIG_HOME/opencode/plugins"
mkdir -p "$plugins/arabic-rtl"
echo 'export default { id: "arabic-rtl" }' >"$plugins/arabic-rtl/tui.js"
echo 'export KEEP=1' >"$AGENT_RTL_RC"

fail() { echo "FAIL: $*" >&2; exit 1; }
quiet() { "$REPO/install.sh" "$@" >/dev/null 2>&1 || fail "install.sh $*"; }

quiet opencode codex agy -y
[ -f "$plugins/agent-rtl/tui.js" ] && [ -f "$plugins/agent-rtl/rtl-core.mjs" ] || fail "opencode plugin missing"
[ ! -e "$plugins/arabic-rtl" ] || fail "old arabic-rtl plugin not replaced"
[ -L "$AGENT_RTL_BIN/agent-rtl" ] || fail "agent-rtl command missing"
grep -q '^codex() ' "$AGENT_RTL_RC" && grep -q '^agy() ' "$AGENT_RTL_RC" || fail "shell functions missing"
grep -q '^export KEEP=1$' "$AGENT_RTL_RC" || fail "rc content lost"

quiet codex -y
[ "$(grep -c '>>> agent-rtl >>>' "$AGENT_RTL_RC")" = 1 ] || fail "block duplicated on reinstall"

quiet --uninstall codex -y
! grep -q '^codex() ' "$AGENT_RTL_RC" && grep -q '^agy() ' "$AGENT_RTL_RC" || fail "uninstall codex"
[ -L "$AGENT_RTL_BIN/agent-rtl" ] || fail "agent-rtl removed while agy still uses it"

quiet --uninstall agy opencode -y
! grep -q 'agent-rtl' "$AGENT_RTL_RC" || fail "block left after last uninstall"
[ ! -e "$AGENT_RTL_BIN/agent-rtl" ] || fail "agent-rtl command left"
[ ! -e "$plugins/agent-rtl" ] || fail "opencode plugin left"
[ "$(cat "$AGENT_RTL_RC")" = 'export KEEP=1' ] || fail "rc not restored exactly"

echo "install.test.sh: all checks passed"
