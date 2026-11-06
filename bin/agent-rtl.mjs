#!/usr/bin/env node
// agent-rtl command: the entry point for `npx github:mehbylabs/agent-rtl` and
// for the installed `agent-rtl`. install/uninstall/status go to install.sh;
// update reinstalls the same agents from the newest release; anything else
// runs a CLI through the RTL wrapper. See USAGE.

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SOURCE = "github:mehbylabs/agent-rtl"
const USAGE = `agent-rtl: right-to-left Arabic, Persian and Hebrew for terminal coding agents

  npx -y ${SOURCE}                  menu: install for all agents or some
  agent-rtl install [agents] [--all] [-y] [--no-alias]
                                     agents: claude opencode codex agy
  agent-rtl uninstall [agents]
  agent-rtl update                   newest version, same agents
  agent-rtl status
  agent-rtl <command> [args]         run a CLI through the RTL wrapper (codex, agy)`
const root = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))))
const home = process.env.AGENT_RTL_HOME || join(process.env.XDG_DATA_HOME || join(process.env.HOME, ".local/share"), "agent-rtl")
const [first, ...rest] = process.argv.slice(2)

function installer(args) {
  const result = spawnSync("bash", [join(root, "install.sh"), ...args], { stdio: "inherit" })
  process.exit(result.status ?? 1)
}

function installedAgents() {
  try {
    return readFileSync(join(home, ".installed"), "utf8").split(/\s+/).filter(Boolean)
  } catch {
    return []
  }
}

switch (first) {
  case undefined:
  case "install":
    installer(rest)
    break
  case "uninstall":
    installer(["--uninstall", ...rest])
    break
  case "status":
    installer(["--status"])
    break
  case "update": {
    const agents = installedAgents()
    if (agents.length === 0) {
      console.error("agent-rtl: nothing installed yet; run: npx -y github:mehbylabs/agent-rtl")
      process.exit(1)
    }
    // The installed copy updates itself by running the newest release from
    // GitHub; that release (or a direct npx run) reinstalls the same agents.
    if (existsSync(home) && root === realpathSync(home) && !process.env.AGENT_RTL_FROM_NPX) {
      const result = spawnSync("npx", ["-y", SOURCE, "update"], {
        stdio: "inherit",
        env: { ...process.env, AGENT_RTL_FROM_NPX: "1" },
      })
      process.exit(result.status ?? 1)
    }
    installer([...agents, "-y"])
    break
  }
  case "-h":
  case "--help":
  case "help":
    console.log(USAGE)
    break
  default: {
    // Anything else is a CLI to run through the wrapper.
    const command = first === "run" ? rest : [first, ...rest]
    if (!existsSync(join(root, "wrapper/node_modules"))) {
      console.error("agent-rtl: the wrapper is not installed; run: npx -y github:mehbylabs/agent-rtl install codex agy")
      process.exit(1)
    }
    process.argv = [process.argv[0], process.argv[1], ...command]
    await import("../wrapper/bin/agent-rtl.mjs")
  }
}
