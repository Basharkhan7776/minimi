# Minimi — Design

## Problem and constraints

The brief's hardest questions combine **time**, **memory**, and **live facts**: "On Monday we shortlisted 5 CRM tools. Has any changed pricing since?", "What did I ask you on 3 November, and is it still true?", "Last Tuesday we discussed Postgres hosting. What changed?" Answering those needs the current date, earlier context, fresh evidence, and a comparison — not a guess from training data.

Constraints: TypeScript on Node, works with `npm install && npm run dev`, local-first storage, any model provider, and a short design write-up.

## Architecture

```text
React 19 + Vite + Coss UI (browser or Tauri webview)
        │ POST /api/chat  (AI SDK UI message stream)
        ▼
Hono server on 127.0.0.1:8787
  ├─ agent: system prompt + streamText + tool loop
  ├─ search: expand → providers → dedupe → extract → dates → cache
  ├─ memory: extract after each turn; hybrid recall before each turn
  └─ reminders: chat tool or fallback extractor → events → 30 s scheduler
        │
        ├─ SQLite WAL: sessions, messages, files, memories, reminders, providers, settings
        ├─ FTS5: messages by keyword and date
        ├─ sqlite-vec: 384-dim memory vectors
        └─ fastembed: local bge-small-en-v1.5 (no embedding API)
```

The Node server owns the agent loop, tools, keys, database, and streaming protocol. The client renders. Tauri is a thin shell around the same web app, not a second implementation. This keeps one tested agent and lets the browser and desktop share everything.

## Request lifecycle

1. Composer sends a `UIMessage` to `POST /api/chat`, with optional attachment IDs.
2. Server creates or loads the session, persists the user message immediately (a refresh never loses it), and loads extracted file text.
3. It recalls relevant memories with a 2.5 s best-effort timeout, then builds a system prompt containing the current date/time, memories, and attachments.
4. `streamText` runs the model with four tools and `stepCountIs(8)`: `web_search`, `fetch_url`, `recall_memory`, `create_reminder`. The model may call them in any order; results return to the same loop.
5. Text, reasoning, and tool calls stream to the UI as they happen. On completion the assistant message is saved. Memory extraction, reminder fallback, and auto-titling run in the background and never delay the response.

Only the last 40 messages are sent to the model. `maxRetries: 1` and temperature 0.4 keep the loop stable without hiding provider errors.

## Why the prompt works

Every request injects the real date, weekday, and timezone. The prompt says: verify anything that could have changed; recall memory first for past-conversation questions, then search to check whether the old answer still holds; cite web claims with the labels returned by search (`[S1]`); never invent URLs; call a page undated if no date is available; lead with the conclusion. The model is a reasoner over evidence, not a source of current facts.

## Search pipeline

For each information need:

1. **Expand** — a cheap model call produces up to three queries (e.g. one per vendor). Trivial queries skip this to save latency.
2. **Search** — DuckDuckGo HTML is the free default. Tavily and Brave are optional when selected; if unavailable, fall back to DuckDuckGo. Expanded queries run in parallel.
3. **Deduplicate** — canonical URLs without fragments/query strings.
4. **Cache** — SQLite, 3-hour TTL by default, keyed by provider, freshness, result count, and normalized query. Freshness searches bypass stale results.
5. **Enrich** — up to three pages, 9 s timeout, 2.5 MB cap, Readability extraction. Text is budgeted across sources so one page cannot crowd out the rest.
6. **Date** — parse OpenGraph/article metadata, `<time datetime>`, and JSON-LD (`datePublished`, `dateCreated`, `uploadDate`), with DDG timestamps as fallback. Normalize to ISO. This is what makes "since Monday" answerable.
7. **Cite** — sources are numbered once after dedupe; the same `S1…Sn` appears in the prompt, tool output, cards, and answer.

Because this runs locally, page fetches block private, loopback, link-local, and `.local` hosts, and redirects are followed manually so every hop is re-checked.

## Memory

Two tiers:

- **Durable memories** extracted after a turn: preferences, decisions, lists, commitments, corrections. The extractor refuses greetings, filler, generic knowledge, and the assistant's own reasoning. Each has a kind, optional event date, session, and source message.
- **Raw messages** in FTS5 with timestamps. This catches everything extraction missed and powers pure date questions.

Recall is hybrid: embed the query locally, take 24 `sqlite-vec` candidates, run FTS5 keyword search with the same date filters, scan user messages for explicit date ranges, then merge rankings and return the best 10–14. A learned reranker would be better; the heuristic is cheap and works when vector similarity is fuzzy but keywords are exact.

Extraction is asynchronous and failure-tolerant: a failed extraction never costs the chat, and **Rebuild from history** re-embeds user turns after model changes. Embeddings run locally; no conversation text leaves the machine for memory.

## Reminders (Second Brain)

Reminders are local rows plus precomputed **events**, which makes the scheduler idempotent: timed reminders get one event at `T`; all-day reminders get events every 2 hours from 09:00 to 21:00 local. Events are unique on `(reminder, kind, scheduled_for)`. A 30 second tick fires due events, including ones that became due while the app was asleep; the client claims them from `/api/reminder-events/pending` and shows a Tauri/browser notification or an in-app toast. A bell in the top-right opens a right-side notification drawer with the active reminders. The agent creates reminders with `create_reminder`; explicit reminder phrases are also caught by a cheap fallback extractor, and `source_message_id` dedupes retries. Chat titles regenerate every six user turns unless the user renamed the chat, which locks the title.

## Storage and providers

SQLite in WAL mode is the entire state: `sessions`, `messages`, `messages_fts`, `files`, `memories`, `vec_memories`, `providers`, `settings`, `search_cache`. Data lives in `~/.local/share/minimi` (platform equivalent; `MINIMI_DATA_DIR` overrides). Migrations are minimal because this is a single-user local app; that would change for a hosted product.

The AI SDK `LanguageModel` is the provider seam: OpenAI, Anthropic, Google, OpenRouter, Ollama, and any OpenAI-compatible endpoint. Keys come from `.env` or Settings, with environment fallback for built-ins. Ollama is enabled by default; environment keys are adopted on startup. "Test connection" surfaces the actual provider error, which makes setup failures obvious.

## Frontend and Tauri

`useChat` + `DefaultChatTransport`; the request body reads from refs so session/provider/model changes never recreate the transport mid-send. A new chat has no session, so the client creates one and sends the first message in the same turn. Rendering is part-based: markdown, collapsed reasoning, tool cards with sources/dates/memory hits, and a deduplicated source grid. A small custom theme provider avoids theme-script console noise.

Tauri loads the same Vite URL and serves the same API; production packaging expects the Node server to be running. Bundling it as a sidecar is the right future step — duplicating the agent in Rust would be a maintenance trap.

## Failure and security

Streaming first; memory, reminders, and titles after. Budgets: 9 s/page, 12 s/search provider, 2.5 s auto-recall. If embeddings fail, FTS still works; if enrichment fails, snippets remain; if a provider fails, the UI shows a retry card with the real error. Work is bounded: 40 messages, 3 queries, 3 pages, 9,000 characters of page text per search, 8 steps.

The API binds to `127.0.0.1` and CORS is restricted to the Vite and Tauri origins, so a random website cannot read local chats through loopback. API keys are excluded from exports; there is no telemetry. Keys are plaintext in SQLite — acceptable for a single-user local app, not for a hosted one.

## Considered and rejected

- **LangChain/agent framework** — hides prompt and tool semantics behind abstractions; the loop is small enough to own.
- **Cloud vector DB** — adds cost, latency, and a network dependency to a local-first app.
- **Embed everything** — slower and noisier than durable facts + FTS.
- **Browser-only app** — exposes keys to the client and makes PDF/DOCX and local vectors hard. Node is the trust boundary.
- **Always expand queries** — a model call for every trivial question.
- **Headless-browser scraping** — better on JS-heavy pages, but slow and fragile; Readability on raw HTML is the better cost/quality point.
- **Rust agent loop in Tauri** — duplicates the most important code.
- **Store full page text forever** — database bloat and staleness.

## What I'd do with another week

1. An evaluation set of time-sensitive questions with source snapshots, scored on citation correctness and "what changed" completeness — quality is currently judged by reading, not a repeatable score.
2. Recency-aware ranking and duplicate-story clustering; dates are parsed but relevance still dominates.
3. Clickable inline `[S1]` citations instead of plain text.
4. Stream search queries as they are issued, not only when the tool returns.
5. Provider fallback and remote model presets.
6. Tauri sidecar packaging, OS-keychain-backed secrets, and reminders that survive a closed app.
7. Memory quality loop: "forget this", duplicate merging, and a preview before saving.

The biggest open question is evidence quality, not architecture: DuckDuckGo HTML is free and good, but not every result exposes a date and some publishers block extraction. The date parser, snippet fallback, and explicit "undated" instruction are the current mitigations; a paid search API or browser fetcher is the next lever.
