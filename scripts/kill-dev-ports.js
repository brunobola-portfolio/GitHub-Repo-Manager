#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.

// Kills any process holding the dev-server ports (backend 3001, Vite 5173 +
// fallbacks 5174-5180). Vite hops to the next free port when 5173 is taken,
// so a dangling instance can cascade across several ports; this script
// cleans them all in one shot.
//
// Cross-platform: uses `netstat` + `taskkill` on Windows, `lsof` + `kill`
// everywhere else. No dependencies.
//
// Usage: npm run dev:kill

import { execSync } from 'child_process'
import { platform } from 'os'

const PORTS = [3001, 5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180]
const isWin = platform() === 'win32'

function run(cmd) {
    try {
        return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
    } catch {
        // Non-zero exit is expected when there's nothing to kill.
        return ''
    }
}

function findPidsWindows() {
    // netstat -ano lists PID as the last column. Filter to LISTEN state on
    // our ports to avoid catching transient TIME_WAIT sockets (which have
    // no owning PID and don't block new listeners anyway).
    const out = run('netstat -ano -p tcp')
    const pids = new Set()
    for (const line of out.split(/\r?\n/)) {
        const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/)
        if (!match) continue
        const port = Number(match[1])
        const pid = Number(match[2])
        if (PORTS.includes(port) && pid > 0) pids.add(pid)
    }
    return [...pids]
}

function findPidsUnix() {
    // `lsof -ti :PORT` returns one PID per line for processes listening on
    // that port. `-t` = terse (PIDs only), `-i` = IP socket.
    const pids = new Set()
    for (const port of PORTS) {
        const out = run(`lsof -ti tcp:${port} -sTCP:LISTEN`)
        for (const line of out.split(/\r?\n/)) {
            const pid = Number(line.trim())
            if (pid > 0) pids.add(pid)
        }
    }
    return [...pids]
}

function killPid(pid) {
    if (isWin) {
        run(`taskkill /F /PID ${pid}`)
    } else {
        run(`kill -9 ${pid}`)
    }
}

const pids = isWin ? findPidsWindows() : findPidsUnix()

if (pids.length === 0) {
    console.log('No dev-server processes found on ports', PORTS.join(', '))
    process.exit(0)
}

console.log(`Found ${pids.length} process(es) holding dev ports: ${pids.join(', ')}`)
for (const pid of pids) {
    killPid(pid)
    console.log(`  killed ${pid}`)
}
console.log('Done. You can now run `npm run dev:all` again.')
