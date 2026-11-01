import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { FALLBACK_REPLY, npcReply, safeError } from './npc-reply.mjs'

const HOST = '127.0.0.1'
const PORT = 4178
const DEMO_ROOT = '/Users/chenjing/dev/agrune/demo'
const DIST_ROOT = path.join(DEMO_ROOT, 'dist')

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

function cleanupPort() {
  try {
    execSync(`lsof -ti:${PORT} | xargs kill -9`, { stdio: 'ignore' })
  } catch {
    // Best effort only.
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendText(res, status, value) {
  res.writeHead(status, { 'content-type': 'text/plain' })
  res.end(value)
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024 * 1024) {
        reject(new Error('request too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function handleNpcReply(req, res) {
  try {
    const payload = await readRequestJson(req)
    sendJson(res, 200, await npcReply(payload))
  } catch (error) {
    console.error(safeError(error))
    sendJson(res, 200, { reply: FALLBACK_REPLY })
  }
}

function staticPathFor(requestPath) {
  let decoded = '/'
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    decoded = '/'
  }

  const normalized = path.normalize(path.join(DIST_ROOT, decoded))
  if (normalized !== DIST_ROOT && !normalized.startsWith(`${DIST_ROOT}${path.sep}`)) {
    return null
  }

  return normalized
}

function serveStatic(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)
  const requestPath = url.pathname === '/' ? '/index.html' : url.pathname
  const candidate = staticPathFor(requestPath)

  if (!candidate) {
    sendText(res, 403, 'Forbidden')
    return
  }

  let filePath = candidate
  try {
    const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null
    if (!stat || !stat.isFile()) {
      filePath = path.join(DIST_ROOT, 'index.html')
    }
  } catch {
    filePath = path.join(DIST_ROOT, 'index.html')
  }

  fs.readFile(filePath, (error, body) => {
    if (error) {
      sendText(res, 404, 'Not found')
      return
    }

    const mimeType = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream'
    res.writeHead(200, {
      'content-type': mimeType,
      'content-length': body.length,
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(body)
  })
}

async function handleRequest(req, res) {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`)

  if (req.method === 'POST' && url.pathname === '/api/npc-reply') {
    await handleNpcReply(req, res)
    return
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res)
    return
  }

  sendText(res, 405, 'Method not allowed')
}

cleanupPort()

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(safeError(error))
    sendJson(res, 500, { error: 'internal server error' })
  })
})

server.listen(PORT, HOST, () => {
  console.log(String(PORT))
})
