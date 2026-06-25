import { useMemo, useState } from 'react'
import {
  chat,
  hasApiKey,
  type ChatMessage,
  type ToolChoice,
  type ToolDefinition,
} from '../lib/openai'

/**
 * Assignment 2 — Live context-switching chatbot.
 *
 * Matches the client requirement literally:
 *  - SAME API connection + SAME stored SINGLE-SESSION chat history stay active
 *    the whole time. `history` is one shared array and is NEVER cleared or
 *    partitioned on a switch — the conversation simply continues.
 *  - A UI button swaps the bot's LIVE context. The active context lives in the
 *    system message, which is rebuilt from the *currently active* context on
 *    every request, so a switch takes effect immediately.
 *  - The system prompt makes the active context AUTHORITATIVE: it overrides
 *    anything said earlier in the same history (including the previous context's
 *    tool result), which is what keeps the tool output correct after a switch
 *    even though the old turns are still in the session.
 *  - A TOOL CALL (`set_indicator`) reflects the active context: "red" -> "Red",
 *    "green" -> "Green".
 */

interface ContextDef {
  id: 'red' | 'green'
  buttonLabel: string
  fact: string
  expected: string
}

const CONTEXTS: Record<ContextDef['id'], ContextDef> = {
  red: {
    id: 'red',
    buttonLabel: 'Favorite color',
    fact: 'My favorite color is red.',
    expected: 'Red',
  },
  green: {
    id: 'green',
    buttonLabel: 'Favorite food',
    fact: 'My favorite food is green apples because I love green.',
    expected: 'Green',
  },
}

const TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'set_indicator',
    description:
      "Display the single keyword that represents the user's current favorite, " +
      'derived strictly from the active context. Call with exactly one capitalized word.',
    parameters: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'One capitalized word, e.g. "Red" or "Green".',
        },
      },
      required: ['keyword'],
    },
  },
}

/**
 * The system prompt is rebuilt from the ACTIVE context on every request and is
 * explicit that the current context wins over anything earlier in the same
 * shared history — so the single session can keep all prior turns while the tool
 * output still flips correctly after a switch.
 */
function systemPromptFor(ctx: ContextDef): string {
  return (
    'You are an assistant in a live context-switching demo. ' +
    `The user's CURRENT context is exactly this single fact: "${ctx.fact}". ` +
    'This current context is the only source of truth. It OVERRIDES anything ' +
    'said earlier in this conversation — including any previous favorite or any ' +
    'earlier tool result. Treat any other favorite, color, or food as no longer ' +
    'true. When the user asks for their keyword / signal / favorite, or asks you ' +
    'to emit or show it, you MUST call the `set_indicator` tool exactly once with ' +
    'the single capitalized word that represents the CURRENT context ' +
    '(a fact about the color red -> "Red"; a fact about loving green / green ' +
    'apples -> "Green"). After the tool result, confirm in one short sentence.'
  )
}

/** A note we render in the transcript to make tool activity visible. */
interface ToolNote {
  role: 'tool-call'
  keyword: string
  contextId: ContextDef['id']
}

type Entry = ChatMessage | ToolNote

function isToolNote(e: Entry): e is ToolNote {
  return (e as ToolNote).role === 'tool-call'
}

const FORCE_TOOL: ToolChoice = {
  type: 'function',
  function: { name: 'set_indicator' },
}

/**
 * True when the user clearly wants the keyword emitted. We force the tool in
 * that case so `set_indicator` fires on the very FIRST turn — otherwise the
 * model often replies in plain text on a cold first turn and only calls the
 * tool from the second turn onward (the "not set the first time" bug).
 */
function wantsIndicator(text: string): boolean {
  return /\b(keyword|signal|indicator|emit)\b/i.test(text)
}

function colorFor(keyword: string): string {
  const k = keyword.toLowerCase()
  if (k.includes('green')) return '#1f9d55'
  if (k.includes('red')) return '#e3342f'
  return '#6b7280'
}

export function ContextSwitchChat() {
  // ONE shared single-session history (system prompt is injected per-request
  // from the active context, so it is not stored here).
  const [history, setHistory] = useState<Entry[]>([])
  const [activeId, setActiveId] = useState<ContextDef['id']>('red')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const active = CONTEXTS[activeId]

  // The full session history, minus the UI-only tool-call notes, is what the
  // API sees every turn — the conversation persists across switches.
  const apiMessages = useMemo(
    () => history.filter((e): e is ChatMessage => !isToolNote(e)),
    [history],
  )

  // The badge reflects the most recent tool output in the session.
  const indicator = useMemo(() => {
    for (let i = history.length - 1; i >= 0; i--) {
      const e = history[i]
      if (isToolNote(e)) return e.keyword
    }
    return ''
  }, [history])

  function push(...items: Entry[]) {
    setHistory((prev) => [...prev, ...items])
  }

  function switchContext() {
    // Same session, same history — only the live context changes.
    setActiveId((id) => (id === 'red' ? 'green' : 'red'))
  }

  async function send(text: string, force = false) {
    const content = text.trim()
    if (!content || busy) return
    if (!hasApiKey()) {
      setError('Set your OpenAI API key first.')
      return
    }
    setError('')
    setInput('')
    setBusy(true)

    // Force the tool on the first model call when the intent is to emit the
    // keyword, so it always fires the first time (not just from turn 2 on).
    const forceFirst = force || wantsIndicator(content)

    // Capture the context active at send time so a mid-request switch is clear.
    const ctx = active
    const ctxId = activeId

    const userMsg: ChatMessage = { role: 'user', content }
    // The conversation the API sees: a fresh system prompt from the ACTIVE
    // context + the full prior single-session history + the new user turn.
    let convo: ChatMessage[] = [
      { role: 'system', content: systemPromptFor(ctx) },
      ...apiMessages,
      userMsg,
    ]
    push(userMsg)

    try {
      let reply = await chat({
        messages: convo,
        tools: [TOOL],
        tool_choice: forceFirst ? FORCE_TOOL : 'auto',
        temperature: 0,
      })

      // Resolve tool calls until the model returns a plain text answer. The
      // final round forces tool_choice 'none' so we always end on text.
      let guard = 0
      while (reply.tool_calls?.length && guard < 3) {
        guard++
        convo = [...convo, reply]
        push(reply)

        for (const call of reply.tool_calls) {
          let keyword = ''
          try {
            keyword = JSON.parse(call.function.arguments)?.keyword ?? ''
          } catch {
            keyword = ''
          }
          if (call.function.name === 'set_indicator' && keyword) {
            push({ role: 'tool-call', keyword, contextId: ctxId })
          }
          const toolMsg: ChatMessage = {
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify({ displayed: keyword }),
          }
          convo = [...convo, toolMsg]
          push(toolMsg)
        }

        reply = await chat({
          messages: convo,
          tools: [TOOL],
          tool_choice: guard >= 2 ? 'none' : 'auto',
          temperature: 0,
        })
      }

      push(reply)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const otherId: ContextDef['id'] = activeId === 'red' ? 'green' : 'red'
  const messageCount = apiMessages.filter((m) => m.role === 'user').length

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Assignment 2 — Live context-switching chatbot</h2>
        <p className="panel-sub">
          One <strong>single-session</strong> chat history and the same API
          connection stay active throughout. The button swaps the bot's live
          context; the active context overrides earlier turns, so the{' '}
          <code>set_indicator</code> tool output follows it (Red → Green).
        </p>
      </header>

      <div className="context-controls">
        <div className="context-state">
          <span className="muted">Active context:</span>
          <span
            className="context-fact"
            style={{ color: colorFor(active.expected) }}
          >
            “{active.fact}”
          </span>
        </div>
        <button className="switch-btn" onClick={switchContext} disabled={busy}>
          ⇄ Switch context to “{CONTEXTS[otherId].buttonLabel}”
        </button>
      </div>

      <div className="indicator-wrap">
        <span className="muted">Tool output (set_indicator):</span>
        <span
          className="indicator-badge"
          style={{
            background: indicator ? colorFor(indicator) : '#e5e7eb',
            color: indicator ? 'white' : '#6b7280',
          }}
        >
          {indicator || '—'}
        </span>
      </div>

      <div className="quick-prompts">
        <button
          onClick={() => send('What is my keyword? Emit it with the tool.', true)}
          disabled={busy}
        >
          Ask for the keyword
        </button>
      </div>

      <div className="chat-log">
        {history.length === 0 && (
          <p className="muted center">
            Ask for the keyword (→ Red), click “Switch context”, then ask again
            (→ Green). The chat history below stays continuous the whole time.
          </p>
        )}
        {history.map((e, i) => (
          <Bubble key={i} entry={e} />
        ))}
        {busy && <div className="bubble assistant typing">…</div>}
      </div>

      <div className="memory-meter">
        <span>Single session · {messageCount} user message(s) retained</span>
      </div>

      {error && <p className="status err">{error}</p>}

      <div className="row ask-row">
        <input
          type="text"
          placeholder="Message the bot…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(input)}
          disabled={busy}
        />
        <button onClick={() => send(input)} disabled={busy || !input.trim()}>
          Send
        </button>
      </div>
    </section>
  )
}

function Bubble({ entry }: { entry: Entry }) {
  if (isToolNote(entry)) {
    return (
      <div className="bubble tool-note">
        🔧 <code>set_indicator</code> called with{' '}
        <strong style={{ color: colorFor(entry.keyword) }}>
          “{entry.keyword}”
        </strong>{' '}
        <span className="muted">(context: {entry.contextId})</span>
      </div>
    )
  }

  const msg = entry
  if (msg.role === 'user') {
    return <div className="bubble user">{msg.content}</div>
  }
  if (msg.role === 'tool') {
    return (
      <div className="bubble tool-note muted">
        ↩ tool result: <code>{msg.content}</code>
      </div>
    )
  }
  // assistant
  if (msg.tool_calls?.length && !msg.content) return null // shown as tool-note instead
  if (!msg.content) return null
  return <div className="bubble assistant">{msg.content}</div>
}
