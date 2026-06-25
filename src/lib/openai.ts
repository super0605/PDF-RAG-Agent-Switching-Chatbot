/**
 * Thin wrapper around the OpenAI REST API using `fetch` only — no SDK.
 *
 * The job posting explicitly notes the project "may require direct use of the
 * OpenAI REST API instead of relying only on OpenAI SDKs", so both demos talk
 * to the two endpoints we need directly:
 *   - POST /v1/embeddings        (RAG: vectorize chunks + queries)
 *   - POST /v1/chat/completions  (both demos: answers + tool calls)
 *
 * The API key is supplied by the user in the UI and kept in localStorage only.
 * For a browser demo this is acceptable; in production the key would live on a
 * Laravel backend and the browser would call your own endpoints instead.
 */

const OPENAI_BASE = 'https://api.openai.com/v1'

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const CHAT_MODEL = 'gpt-4o-mini'

const KEY_STORAGE = 'openai_api_key'

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE)?.trim() ?? ''
}

export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim())
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const key = getApiKey()
  if (!key) throw new Error('No OpenAI API key set. Paste your key in the bar at the top.')

  const res = await fetch(`${OPENAI_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const err = await res.json()
      if (err?.error?.message) detail = err.error.message
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new Error(`OpenAI API error: ${detail}`)
  }

  return res.json() as Promise<T>
}

/* ---------- Embeddings ---------- */

interface EmbeddingResponse {
  data: { embedding: number[]; index: number }[]
}

/** Embed a batch of strings; returns one vector per input, order preserved. */
export async function embed(input: string[]): Promise<number[][]> {
  if (input.length === 0) return []
  const res = await postJson<EmbeddingResponse>('/embeddings', {
    model: EMBEDDING_MODEL,
    input,
  })
  return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

/* ---------- Chat completions (incl. tool calling) ---------- */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  /** assistant -> tool calls it wants to make */
  tool_calls?: ToolCall[]
  /** tool messages must reference the call they answer */
  tool_call_id?: string
  /** optional label, mainly for tool messages */
  name?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

interface ChatResponse {
  choices: { message: ChatMessage; finish_reason: string }[]
}

/** "auto" | "none" | "required", or force a specific function by name. */
export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } }

export interface ChatOptions {
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  tool_choice?: ToolChoice
  temperature?: number
}

export async function chat(opts: ChatOptions): Promise<ChatMessage> {
  const res = await postJson<ChatResponse>('/chat/completions', {
    model: CHAT_MODEL,
    messages: opts.messages,
    tools: opts.tools,
    tool_choice: opts.tools ? opts.tool_choice ?? 'auto' : undefined,
    temperature: opts.temperature ?? 0.2,
  })
  return res.choices[0].message
}
