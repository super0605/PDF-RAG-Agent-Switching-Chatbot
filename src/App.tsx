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
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>OpenAI API Demos</h1>
            <p className="app-sub">
              RAG over a PDF &amp; live context switching · React + TypeScript ·
              direct OpenAI REST API (no SDK)
            </p>
          </div>
        </div>
      </header>

      <ApiKeyBar />

      <nav className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'rag'}
          className={tab === 'rag' ? 'tab active' : 'tab'}
          onClick={() => setTab('rag')}
        >
          <span className="tab-num">1</span> RAG over a PDF
        </button>
        <button
          role="tab"
          aria-selected={tab === 'context'}
          className={tab === 'context' ? 'tab active' : 'tab'}
          onClick={() => setTab('context')}
        >
          <span className="tab-num">2</span> Live context switching
        </button>
      </nav>

      <main>{tab === 'rag' ? <RagPdfAgent /> : <ContextSwitchChat />}</main>

      <footer className="app-foot">
        Demo build · API key stored in your browser only · models configurable in{' '}
        <code>src/lib/openai.ts</code>
      </footer>
    </div>
  )
}
