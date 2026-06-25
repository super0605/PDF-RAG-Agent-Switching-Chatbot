import { useState } from 'react'
import { getApiKey, setApiKey } from '../lib/openai'

/**
 * Top bar where the user pastes their OpenAI API key. Stored in localStorage
 * only (never sent anywhere except api.openai.com). Both demos read it via
 * getApiKey().
 */
export function ApiKeyBar() {
  const [key, setKey] = useState(getApiKey())
  const [saved, setSaved] = useState(false)

  function save() {
    setApiKey(key)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="apikey-bar">
      <label htmlFor="apikey">OpenAI API key</label>
      <input
        id="apikey"
        type="password"
        placeholder="sk-..."
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        autoComplete="off"
      />
      <button onClick={save} disabled={!key.trim()}>
        {saved ? 'Saved ✓' : 'Save'}
      </button>
      <span className="apikey-hint">
        Stored in your browser only. Used directly against the OpenAI REST API.
      </span>
    </div>
  )
}
