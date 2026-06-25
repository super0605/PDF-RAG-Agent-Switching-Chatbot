/**
 * Minimal in-memory vector store + retrieval for the RAG demo.
 * Embeddings are computed once per chunk and kept in memory; retrieval is a
 * cosine-similarity scan (fine for a single PDF / hundreds of chunks).
 */
import { chat, embed, type ChatMessage } from './openai'
import type { Chunk } from './pdf'

export interface IndexedChunk extends Chunk {
  embedding: number[]
}

export interface RetrievedChunk extends IndexedChunk {
  score: number
}

function dot(a: number[], b: number[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

function norm(a: number[]): number {
  return Math.sqrt(dot(a, a))
}

function cosineSimilarity(a: number[], b: number[]): number {
  const denom = norm(a) * norm(b)
  return denom === 0 ? 0 : dot(a, b) / denom
}

/** Embed all chunks (in batches) and return an in-memory index. */
export async function buildIndex(
  chunks: Chunk[],
  onProgress?: (done: number, total: number) => void,
): Promise<IndexedChunk[]> {
  const index: IndexedChunk[] = []
  const batchSize = 64

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize)
    const vectors = await embed(batch.map((c) => c.text))
    batch.forEach((c, j) => index.push({ ...c, embedding: vectors[j] }))
    onProgress?.(Math.min(i + batchSize, chunks.length), chunks.length)
  }

  return index
}

/** Return the top-k chunks most similar to the query. */
export async function retrieve(
  query: string,
  index: IndexedChunk[],
  k = 4,
): Promise<RetrievedChunk[]> {
  const [queryVec] = await embed([query])
  return index
    .map((c) => ({ ...c, score: cosineSimilarity(queryVec, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

export interface RagAnswer {
  answer: string
  sources: RetrievedChunk[]
}

/**
 * Full RAG step: retrieve relevant chunks, then answer grounded ONLY in them.
 * The system prompt forbids using outside knowledge and requires citing pages,
 * which is what keeps answers accurate to the PDF rather than hallucinated.
 */
export async function answerQuestion(
  question: string,
  index: IndexedChunk[],
  k = 4,
): Promise<RagAnswer> {
  const sources = await retrieve(question, index, k)

  const context = sources
    .map((s) => `[Chunk ${s.id} — page ${s.page}]\n${s.text}`)
    .join('\n\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a retrieval-augmented assistant. Answer the user\'s question ' +
        'using ONLY the context passages provided below. If the answer is not ' +
        'contained in the context, say "I could not find that in the document." ' +
        'Cite the page number(s) you used in parentheses, e.g. (p. 3).\n\n' +
        `Context:\n${context}`,
    },
    { role: 'user', content: question },
  ]

  const reply = await chat({ messages, temperature: 0 })
  return { answer: reply.content ?? '', sources }
}
