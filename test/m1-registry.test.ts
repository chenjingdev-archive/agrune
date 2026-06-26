import { describe, it, expect } from 'vitest'
import {
  workspaceHash,
  workspaceRunDir,
  defaultSocketPath,
  getDaemonEndpoint,
} from '../src/registry.js'

function withEnvSocket<T>(value: string | undefined, fn: () => T): T {
  const prev = process.env.AGRUNE_DAEMON_SOCKET
  if (value === undefined) delete process.env.AGRUNE_DAEMON_SOCKET
  else process.env.AGRUNE_DAEMON_SOCKET = value
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env.AGRUNE_DAEMON_SOCKET
    else process.env.AGRUNE_DAEMON_SOCKET = prev
  }
}

describe('M1 — workspace hash & socket path (§7.1 / A.1.2)', () => {
  it('hash is a deterministic 12-hex-char sha256 prefix', () => {
    const h = workspaceHash('/Users/chenjing/dev/agrune/agrune')
    expect(h).toMatch(/^[0-9a-f]{12}$/)
    expect(workspaceHash('/Users/chenjing/dev/agrune/agrune')).toBe(h)
  })

  it('default socket path lives under ~/.agrune/run/<hash>/daemon.sock on posix', () => {
    if (process.platform === 'win32') return
    const p = defaultSocketPath('/Users/chenjing/dev/agrune/agrune')
    expect(p).toMatch(/\.agrune\/run\/[0-9a-f]{12}\/daemon\.sock$/)
  })
})

describe('M1 — endpoint precedence (A.1.2)', () => {
  it('--host/--port → http://… explicit', () => {
    const e = getDaemonEndpoint({ host: '127.0.0.1', port: '47999' })
    expect(e.endpoint).toBe('http://127.0.0.1:47999')
    expect(e.explicit).toBe(true)
  })

  it('AGRUNE_DAEMON_SOCKET → unix:… NON-explicit (a local override that auto-spawns, A2)', () => {
    withEnvSocket('/tmp/custom.sock', () => {
      const e = getDaemonEndpoint({})
      expect(e.endpoint).toBe('unix:/tmp/custom.sock')
      // A custom socket is a local path we bind ourselves → first command must auto-spawn.
      expect(e.explicit).toBe(false)
    })
  })

  it('--host/--port stays explicit even with a custom socket set (remote wins, never auto-spawned)', () => {
    withEnvSocket('/tmp/custom.sock', () => {
      const e = getDaemonEndpoint({ host: '10.0.0.1', port: '47999' })
      expect(e.endpoint).toBe('http://10.0.0.1:47999')
      expect(e.explicit).toBe(true)
    })
  })

  it('default → unix workspace socket, non-explicit (auto-spawns)', () => {
    withEnvSocket(undefined, () => {
      const e = getDaemonEndpoint({})
      expect(e.endpoint.startsWith('unix:')).toBe(true)
      expect(e.explicit).toBe(false)
    })
  })
})

describe('M1 — custom socket gets an isolated run dir (A2: no session/lock collision)', () => {
  it('a custom socket keys the run dir off the socket, not the workspace', () => {
    const cwd = '/Users/chenjing/dev/agrune/agrune'
    const wsDir = withEnvSocket(undefined, () => workspaceRunDir(cwd))
    const sockDir = withEnvSocket('/tmp/custom.sock', () => workspaceRunDir(cwd))
    // Same cwd, but the override moves the session file + spawn lock to a different dir, so a
    // custom-socket command can never kill the default daemon during stale-state cleanup.
    expect(sockDir).not.toBe(wsDir)
    expect(sockDir).toMatch(/\.agrune\/run\/[0-9a-f]{12}$/)
  })

  it('two distinct custom sockets get distinct run dirs (concurrent isolation)', () => {
    const cwd = '/Users/chenjing/dev/agrune/agrune'
    const a = withEnvSocket('/tmp/a.sock', () => workspaceRunDir(cwd))
    const b = withEnvSocket('/tmp/b.sock', () => workspaceRunDir(cwd))
    expect(a).not.toBe(b)
  })
})
