import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DEMO_ROOT = '/Users/chenjing/dev/agrune/demo'
const FACTS_PATH = path.join(DEMO_ROOT, 'npc-facts.json')
const DEFAULT_BASE_URL = 'http://127.0.0.1:18765'

export const FALLBACK_REPLY = '(지금 자리에 없네요. 잠시 후 다시 말 걸어주세요!)'

let proxyToken = null

function readFacts() {
  return JSON.parse(fs.readFileSync(FACTS_PATH, 'utf8'))
}

function buildSystemPrompt(memberId) {
  const facts = readFacts()
  const defaults = facts.default ?? {}
  const member = facts.members?.[memberId]

  if (!member) {
    return `당신은 '동료'(Coworker)입니다. 사용자의 팀 동료입니다.\n말투/규칙: ${defaults.tone ?? ''}\n`
  }

  let prompt = `당신은 '${member.name}'(${member.role})입니다. ${member.persona}\n말투/규칙: ${defaults.tone}\n`

  if (member.todayTask) {
    const task = member.todayTask
    prompt += `오늘 사용자가 새로 등록해야 할 일감이 있습니다: '${task.title}' — ${task.summary} 담당자는 ${task.assigneeHint}. 사용자가 '오늘 할 일/일감/뭐 하면 돼/today/task/work' 류로 물으면 이 일을 자연스럽게 알려주세요. 묻지 않은 정보를 먼저 말하지 말고, 일감 제목은 위 내용을 그대로 전달(지어내기 금지).`
  }

  if (member.opinions) {
    prompt += `${member.todayTask ? '\n' : ''}다음 사안에 대한 당신의 입장: `
    for (const [key, value] of Object.entries(member.opinions)) {
      prompt += `\n${key}: ${Array.isArray(value) ? value.join(', ') : value}`
    }
  }

  if (!member.todayTask) {
    prompt += `${member.opinions ? '\n' : ''}오늘 사용자에게 새로 맡길 일감은 없습니다. 물으면 다음처럼 답하세요: ${defaults.noTaskLine}`
  }

  return prompt
}

function convertMessages(inputMessages) {
  const messages = Array.isArray(inputMessages)
    ? inputMessages
        .filter((message) => {
          return (
            message &&
            (message.from === 'me' || message.from === 'them') &&
            typeof message.body === 'string' &&
            message.body.trim()
          )
        })
        .map((message) => ({
          role: message.from === 'me' ? 'user' : 'assistant',
          content: message.body,
        }))
    : []

  while (messages.length && messages[messages.length - 1].role !== 'user') {
    messages.pop()
  }

  if (!messages.length) {
    return [{ role: 'user', content: '안녕하세요' }]
  }

  return messages
}

function getProxyToken() {
  if (proxyToken) return proxyToken

  const raw = execFileSync('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], {
    encoding: 'utf8',
  })
  const parsed = JSON.parse(raw)
  const token = parsed?.claudeAiOauth?.accessToken
  if (!token) throw new Error('missing Claude Code OAuth token')
  proxyToken = token
  return proxyToken
}

export function safeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]').slice(0, 400)
}

async function getNpcReply({ memberId, messages } = {}) {
  const system = buildSystemPrompt(memberId)
  const convertedMessages = convertMessages(messages)
  const base = process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL
  const key = getProxyToken()

  const res = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'oauth-2025-04-20',
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-5.5',
      max_tokens: 220,
      system,
      messages: convertedMessages,
      temperature: 0,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`proxy HTTP ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  if (json.type === 'error') {
    throw new Error(`proxy error: ${JSON.stringify(json.error).slice(0, 200)}`)
  }

  return (json.content ?? [])
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim()
}

// Most-recent user-authored line in the thread (what the NPC is replying to).
function lastUserText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.from === 'me' && typeof m.body === 'string') return m.body
  }
  return ''
}

// "Are you asking what to do / register today?" — the same intent the live NPC's
// persona prompt is told to answer ("오늘 할 일/일감/뭐 하면 돼/today/task/work").
const TASK_ASK_RE = /오늘|할\s*일|일감|뭐\s*(하|할|함|해|돼|되)|today|task|work|등록|새\s*티켓|ticket|register/i

// Deterministic, fact-driven reply used when the live NPC LLM is unreachable
// (no proxy). It mirrors the persona rule — reveal today's task ONLY when actually
// asked — so the bench stays reproducible and S7 is still scorable offline. The
// answer carries the authored todayTask title verbatim (never invented).
function deterministicReply({ memberId, messages } = {}) {
  const facts = readFacts()
  const member = facts.members?.[memberId]
  const asked = TASK_ASK_RE.test(lastUserText(messages))
  if (member?.todayTask && asked) {
    const t = member.todayTask
    return `오늘은 '${t.title}' 건을 새 티켓으로 등록해 주세요. ${t.summary} 담당은 ${t.assigneeHint}.`
  }
  if (member && !member.todayTask && asked) {
    return facts.default?.noTaskLine || FALLBACK_REPLY
  }
  return FALLBACK_REPLY
}

export async function npcReply(payload) {
  try {
    const reply = await getNpcReply(payload)
    if (reply) return { reply }
  } catch (error) {
    console.error(safeError(error))
  }
  // Live NPC empty/unreachable → deterministic fact-driven fallback (offline-safe).
  return { reply: deterministicReply(payload) }
}
