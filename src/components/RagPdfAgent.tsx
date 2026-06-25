import { useRef, useState } from 'react'
import { hasApiKey } from '../lib/openai'
import { chunkPages, extractPdfText } from '../lib/pdf'
import {
  answerQuestion,
  buildIndex,
  type IndexedChunk,
  type RetrievedChunk,
} from '../lib/rag'

interface QA {
  question: string
  answer: string
  sources: RetrievedChunk[]
}

type Status =
  | { kind: 'idle' }
  | { kind: 'parsing' }
  | { kind: 'embedding'; done: number; total: number }
  | { kind: 'ready' }
  | { kind: 'asking' }
  | { kind: 'error'; message: string }

/**
 * Assignment 1 — RAG AI agent.
 * Upload a PDF -> extract & chunk text -> embed chunks -> ask questions that are
 * answered ONLY from the retrieved chunks, with page citations + shown sources.
 */
export function RagPdfAgent() {
  const [fileName, setFileName] = useState('')
  const [index, setIndex] = useState<IndexedChunk[]>([])
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<QA[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!hasApiKey()) {
      setStatus({ kind: 'error', message: 'Set your OpenAI API key first.' })
      return
    }

    setFileName(file.name)
    setHistory([])
    setIndex([])

    try {
      setStatus({ kind: 'parsing' })
      const pages = await extractPdfText(file)
      const chunks = chunkPages(pages)
      if (chunks.length === 0) {
        setStatus({
          kind: 'error',
          message:
            'No selectable text found. This looks like a scanned/image PDF (OCR not included in this demo).',
        })
        return
      }

      setStatus({ kind: 'embedding', done: 0, total: chunks.length })
      const built = await buildIndex(chunks, (done, total) =>
        setStatus({ kind: 'embedding', done, total }),
      )
      setIndex(built)
      setStatus({ kind: 'ready' })
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message })
    }
  }

  async function ask() {
    const q = question.trim()
    if (!q || index.length === 0) return
    setQuestion('')
    setStatus({ kind: 'asking' })
    try {
      const { answer, sources } = await answerQuestion(q, index)
      setHistory((h) => [...h, { question: q, answer, sources }])
      setStatus({ kind: 'ready' })
    } catch (err) {
      setStatus({ kind: 'error', message: (err as Error).message })
    }
  }

  const busy = status.kind === 'parsing' || status.kind === 'embedding' || status.kind === 'asking'

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Assignment 1 — RAG agent over a PDF</h2>
        <p className="panel-sub">
          Upload a PDF, then ask questions. Answers are grounded only in the
          retrieved passages and cite the page they came from.
        </p>
      </header>

      <div className="row">
        <button onClick={() => fileInput.current?.click()} disabled={busy}>
          {fileName ? 'Choose a different PDF' : 'Upload PDF'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf"
          onChange={onFile}
          hidden
        />
        {fileName && <span className="filename">{fileName}</span>}
      </div>

      <StatusLine status={status} chunkCount={index.length} />

      {index.length > 0 && (
        <div className="row ask-row">
          <input
            type="text"
            placeholder="Ask something about the PDF…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()}
            disabled={busy}
          />
          <button onClick={ask} disabled={busy || !question.trim()}>
            Ask
          </button>
        </div>
      )}

      <div className="qa-list">
        {history
          .slice()
          .reverse()
          .map((qa, i) => (
            <article key={history.length - i} className="qa">
              <div className="qa-q">Q: {qa.question}</div>
              <div className="qa-a">{qa.answer}</div>
              <details className="qa-src">
                <summary>{qa.sources.length} retrieved source chunk(s)</summary>
                {qa.sources.map((s) => (
                  <div key={s.id} className="src-chunk">
                    <span className="src-meta">
                      page {s.page} · similarity {s.score.toFixed(3)}
                    </span>
                    <p>{s.text}</p>
                  </div>
                ))}
              </details>
            </article>
          ))}
      </div>
    </section>
  )
}

function StatusLine({ status, chunkCount }: { status: Status; chunkCount: number }) {
  switch (status.kind) {
    case 'parsing':
      return <p className="status">Extracting text from PDF…</p>
    case 'embedding':
      return (
        <p className="status">
          Embedding chunks… {status.done}/{status.total}
        </p>
      )
    case 'ready':
      return (
        <p className="status ok">
          Indexed {chunkCount} chunk(s). Ready for questions.
        </p>
      )
    case 'asking':
      return <p className="status">Retrieving + answering…</p>
    case 'error':
      return <p className="status err">{status.message}</p>
    default:
      return null
  }
}
