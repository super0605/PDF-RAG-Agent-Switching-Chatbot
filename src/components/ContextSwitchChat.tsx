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
 * Requirements demonstrated:
 *  - SAME API connection + SAME live session the whole time (`chat()` / the same
 *    model, one mounted component — nothing is torn down on a switch).
 *  - A UI button swaps the bot's LIVE context.
 *  - The active context is ISOLATED: each context has its own memory partition,
 *    so switching never lets the other context's chat / tool results bleed in.
 *    The model only ever sees the active context's messages, which is what makes
 *    the output deterministic ("only remember results related to the active
 *    context"). Switch away and back and a context still remembers its OWN thread.
 *  - A TOOL CALL (`set_indicator`) reflects the active context: the "red" context
 *    yields "Red"; the "green" context yields "Green".
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

function systemPromptFor(ctx: ContextDef): string {
  return (
    'You are an assistant in a live context-switching demo. ' +
    `The ONLY thing you know about the user is this single fact: "${ctx.fact}". ` +
    'Ignore and never mention any other favorite, color, or food that is not ' +
    'stated in that fact — treat anything else as unknown. ' +
    'When the user asks for their keyword / signal / favorite, or asks you to ' +
    'emit or show it, you MUST call the `set_indicator` tool exactly once with ' +
    'the single capitalized word that represents THIS fact ' +
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

const EMPTY_HISTORIES: Record<ContextDef['id'], Entry[]> = { red: [], green: [] }

export function ContextSwitchChat() {
  // One session, but memory is partitioned per context so the active context
  // never sees the other context's messages/tool results.
  const [histories, setHistories] =
    useState<Record<ContextDef['id'], Entry[]>>(EMPTY_HISTORIES)
  const [activeId, setActiveId] = useState<ContextDef['id']>('red')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const active = CONTEXTS[activeId]
  const entries = histories[activeId]

  // Only the active context's real chat messages are sent to the API.
  const apiMessages = useMemo(
    () => entries.filter((e): e is ChatMessage => !isToolNote(e)),
    [entries],
  )

  // The badge reflects the active context's most recent tool output.
  const indicator = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (isToolNote(e)) return e.keyword
    }
    return ''
  }, [entries])

  function pushTo(id: ContextDef['id'], ...items: Entry[]) {
    setHistories((prev) => ({ ...prev, [id]: [...prev[id], ...items] }))
  }

  function switchContext() {
    // Same session; just activate the other context's memory partition.
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

    // Capture the context this turn belongs to so a mid-request switch can't
    // misroute messages.
    const ctx = active
    const ctxId = activeId

    const userMsg: ChatMessage = { role: 'user', content }
    // The conversation the API sees: system prompt from the ACTIVE context +
    // ONLY this context's prior messages + the new user turn.
    let convo: ChatMessage[] = [
      { role: 'system', content: systemPromptFor(ctx) },
      ...apiMessages,
      userMsg,
    ]
    pushTo(ctxId, userMsg)

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
        pushTo(ctxId, reply)

        for (const call of reply.tool_calls) {
          let keyword = ''
          try {
            keyword = JSON.parse(call.function.arguments)?.keyword ?? ''
          } catch {
            keyword = ''
          }
          if (call.function.name === 'set_indicator' && keyword) {
            pushTo(ctxId, { role: 'tool-call', keyword, contextId: ctxId })
          }
          const toolMsg: ChatMessage = {
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify({ displayed: keyword }),
          }
          convo = [...convo, toolMsg]
          pushTo(ctxId, toolMsg)
        }

        reply = await chat({
          messages: convo,
          tools: [TOOL],
          tool_choice: guard >= 2 ? 'none' : 'auto',
          temperature: 0,
        })
      }

      pushTo(ctxId, reply)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const otherId: ContextDef['id'] = activeId === 'red' ? 'green' : 'red'

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Assignment 2 — Live context-switching chatbot</h2>
        <p className="panel-sub">
          Same session &amp; API connection. The button swaps the live context;
          each context keeps its <strong>own isolated memory</strong>, so results
          from the other context never leak in. The <code>set_indicator</code>{' '}
          tool output follows the active context.
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
        {entries.length === 0 && (
          <p className="muted center">
            This “{active.buttonLabel}” context has its own memory. Ask for the
            keyword, switch context, and ask again — the two never mix.
          </p>
        )}
        {entries.map((e, i) => (
          <Bubble key={i} entry={e} />
        ))}
        {busy && <div className="bubble assistant typing">…</div>}
      </div>

      <div className="memory-meter">
        <span style={{ color: colorFor('red') }}>
          Red memory: {histories.red.filter((e) => !isToolNote(e)).length} msg
        </span>
        <span style={{ color: colorFor('green') }}>
          Green memory: {histories.green.filter((e) => !isToolNote(e)).length} msg
        </span>
      </div>

      {error && <p className="status err">{error}</p>}

      <div className="row ask-row">
        <input
          type="text"
          placeholder={`Message the bot (in “${active.buttonLabel}” context)…`}
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
