# OpenAI API Demos — RAG over a PDF + Live Context Switching

One **React + TypeScript** (Vite) app containing both hiring-assignment demos.
It talks **directly to the OpenAI REST API with `fetch`** — no OpenAI SDK — which
matches the posting's note about using the REST API directly.

> The original posting's stack is Laravel + Vue. This implementation is React +
> TypeScript per the build request. The architecture maps 1:1 onto Laravel/Vue:
> the OpenAI calls in [`src/lib/openai.ts`](src/lib/openai.ts) would move behind
> Laravel controller endpoints (keeping the API key server-side), and the Vue
> components would mirror the React ones.

## Quick start

```bash
npm install
npm run dev
```

Open the app, paste an **OpenAI API key** into the bar at the top (stored in
`localStorage` only, sent only to `api.openai.com`), then use either tab.

```bash
npm run build      # type-check + production build
npm run typecheck  # type-check only
```

## Assignment 1 — RAG agent over a PDF

Tab **“1 · RAG over a PDF”**.

Pipeline (all client-side except the OpenAI calls):

1. **Extract** text per page with `pdf.js` — [`src/lib/pdf.ts`](src/lib/pdf.ts).
2. **Chunk** into overlapping ~180-word windows.
3. **Embed** every chunk with `text-embedding-3-small` into an in-memory vector
   store — [`src/lib/rag.ts`](src/lib/rag.ts).
4. **Retrieve** the top-k chunks for a question by cosine similarity.
5. **Answer** with `gpt-4o-mini`, grounded **only** in the retrieved chunks, with
   page citations. The system prompt forbids outside knowledge, so answers stay
   accurate to the document. Retrieved source chunks + similarity scores are
   shown for transparency.

> Uses text-based PDFs. Scanned/image-only PDFs would need OCR (not included).

## Assignment 2 — Live context-switching chatbot

Tab **“2 · Live context switching”** — [`src/components/ContextSwitchChat.tsx`](src/components/ContextSwitchChat.tsx).

Demonstrates context switching **within one active session**:

- **Same API connection + same single-session history.** There is one shared
  `history` array; it is never cleared or partitioned. Switching context does
  **not** reset the conversation — every prior turn stays in the session.
- **Live context swap via a UI button.** The active context lives in the system
  message, which is rebuilt from the *currently active* context on every request.
  Clicking **⇄ Switch context** flips it immediately. The system prompt makes the
  active context **authoritative** — it overrides anything said earlier in the
  same history (including the previous context's tool result), so the tool output
  flips correctly even though the old turns remain in the session.
- **Tool call follows the context.** A `set_indicator` function tool is exposed.
  When the user asks for the keyword, the call is *forced* (`tool_choice`) so it
  fires reliably on the first turn. Reading the active context, the model calls it
  with the right keyword:

  | Active context | Tool output |
  | --- | --- |
  | "My favorite color is red." | **Red** |
  | "My favorite food is green apples because I love green." | **Green** |

### Try it

1. Click **“Ask for the keyword”** → tool fires `set_indicator("Red")`, badge turns red.
2. Click **“⇄ Switch context”** — the chat history stays on screen and in the session.
3. Click **“Ask for the keyword”** again → same session & history, now `set_indicator("Green")`, badge turns green.

The transcript shows each 🔧 tool call and its result so the tool-call behavior
is visible, proving the swap affected the AI/tool output — not just the text.

## Project layout

```
src/
  lib/
    openai.ts   REST client: embeddings + chat/tool-calling (fetch, no SDK)
    pdf.ts      pdf.js text extraction + chunking
    rag.ts      embeddings index, cosine retrieval, grounded answering
  components/
    ApiKeyBar.tsx        shared API-key input
    RagPdfAgent.tsx      Assignment 1 UI
    ContextSwitchChat.tsx Assignment 2 UI
  App.tsx       tab shell
```

## Notes

- The browser-side API key is fine for a local demo; in production the key stays
  on the Laravel backend and the browser calls your own endpoints.
- Models are set in [`src/lib/openai.ts`](src/lib/openai.ts) (`CHAT_MODEL`,
  `EMBEDDING_MODEL`) and easy to swap.
```
