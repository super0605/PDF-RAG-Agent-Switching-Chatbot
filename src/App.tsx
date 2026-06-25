import { useState } from 'react'
import { ApiKeyBar } from './components/ApiKeyBar'
import { RagPdfAgent } from './components/RagPdfAgent'
import { ContextSwitchChat } from './components/ContextSwitchChat'

type Tab = 'rag' | 'context'

export default function App() {
  const [tab, setTab] = useState<Tab>('rag')

  return (
    <div className="app">
      <header className="app-head">
        <h1>OpenAI API Demos — RAG + Live Context Switching</h1>
        <p className="app-sub">
          One React + TypeScript app, two assignments. Talks directly to the
          OpenAI REST API (no SDK).
        </p>
      </header>

      <ApiKeyBar />

      <nav className="tabs">
        <button
          className={tab === 'rag' ? 'tab active' : 'tab'}
          onClick={() => setTab('rag')}
        >
          1 · RAG over a PDF
        </button>
        <button
          className={tab === 'context' ? 'tab active' : 'tab'}
          onClick={() => setTab('context')}
        >
          2 · Live context switching
        </button>
      </nav>

      <main>{tab === 'rag' ? <RagPdfAgent /> : <ContextSwitchChat />}</main>
    </div>
  )
}
