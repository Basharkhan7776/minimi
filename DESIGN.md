# Minimi — Design

## 1. Executive summary

Minimi is a **local-first research agent** for questions that combine time, memory, and live facts: "On Monday we shortlisted five CRM tools. Has any changed pricing?", "What did I ask you on 3 November, and is it still true?", "Last Tuesday we discussed Postgres hosting. What changed?"

It is a TypeScript application with three surfaces:

- **React 19 + Vite** for the browser UI.
- **Hono on Node 20+** for the trusted agent, tools, persistence, and streaming protocol.
- **Tauri** as a thin desktop shell around the same UI and the same local server.

The Node process is the trust boundary. It owns API keys, the SQLite database, prompt construction, model calls, tools, search, embeddings, reminders, and background work. The client renders state and sends user intent. Tauri does not duplicate the agent in Rust.

The hard product requirement is not "call a model". It is **recovering the right context, knowing the current date, verifying current facts, and remembering what changed**. The architecture is therefore built around four flows: streaming chat, evidence gathering, hybrid memory, and durable reminders.

## 2. Goals, constraints, and non-goals

### Goals

- Work with `npm install && npm run dev`.
- Keep conversations, files, memories, and reminders on the user's machine.
- Support OpenAI, Anthropic, Google, OpenRouter, Ollama, and compatible endpoints through one provider seam.
- Answer time-sensitive questions with dated, cited evidence.
- Recall earlier conversations through durable memories plus raw-message search.
- Turn explicit future commitments into reminders that notify while Minimi is running.
- Expose real provider errors instead of hiding setup failures.

### Constraints

- TypeScript on Node.
- SQLite as the only required datastore.
- One local user, one API process.
- No cloud vector database and no telemetry.
- Browser and Tauri must share one implementation.
- A reminder scheduler cannot depend on the browser being open.

### Non-goals

- Multi-user accounts or hosted deployment.
- Closed-app reminders; the Node server must be running.
- A Rust reimplementation of the agent loop.
- Exact-time background execution while the OS is suspended.

## 3. High-level design (HLD)

### 3.1 System context

```text
┌───────────────────────────────┐          ┌───────────────────────────────┐
│ Browser or Tauri webview      │  /api    │ Node 20+ / Hono               │
│ React 19, Vite, Coss UI       │◄────────►│ sessions, settings, files     │
│ useChat + UI message stream   │  HTTP    │ agent loop + tool execution   │
│ Tauri notification plugin     │  + SSE   │ search, memory, reminders     │
└───────────────┬───────────────┘          └───────────────┬───────────────┘
                │                                          │
                │ OS notification                          ├─► LLM providers
                ▼                                          ├─► DDG / Tavily / Brave
         Operating system                                  ├─► public web pages
                                                           ├─► local fastembed
                                                           └─► SQLite WAL + FTS5
                                                               + sqlite-vec
```

External dependencies are deliberately replaceable:

- **Models**: AI SDK `LanguageModel` implementations.
- **Search**: DuckDuckGo HTML by default; Tavily and Brave optional.
- **Embeddings**: local `bge-small-en-v1.5` through fastembed.
- **Storage**: local SQLite; no server database.
- **Notifications**: Tauri plugin, browser Notification API, or in-app toast.

### 3.2 Runtime topology

**Development**

`npm run dev` starts two processes with `concurrently`:

1. `tsx watch server/index.ts` on `127.0.0.1:8787`.
2. Vite on `localhost:1420`, proxying `/api` to the Node server.

**Production web**

`npm run build` emits `dist/`. `npm start` runs the same Node server and serves `dist/` from Hono. The browser opens `http://127.0.0.1:8787`.

**Desktop**

Tauri loads the Vite development URL or the built frontend. In production, Tauri still expects the Node server to be running separately. Sidecar packaging is the obvious next step.

### 3.3 Component responsibilities

| Component | Owns | Does not own |
| --- | --- | --- |
| `src/App.tsx` | top-level UI state, session selection, reminder polling, dialogs | prompt construction, provider calls |
| `src/components/chat/*` | composer, message rendering, tool cards, sources | persistence, tool execution |
| `src/components/app-sidebar.tsx` | search, pinned/recent chats, settings entry | reminders |
| `src/components/reminders/*` | reminder drawer, rows, add/edit form | scheduling |
| `server/index.ts` | HTTP routes, CORS, SSE chat, import/export, scheduler startup | UI rendering |
| `server/agent/*` | prompt, tools, provider factory, agent loop, titles | HTTP parsing |
| `server/search/*` | query expansion, providers, extraction, dates, cache | model chat loop |
| `server/memory.ts` | extraction, hybrid recall, rebuild, reminder-memory sync | UI |
| `server/reminders/*` | validation, scheduling rules, fallback extraction, engine | rendering |
| `server/db/*` | schema, migrations, DAOs, settings, providers | business decisions |
| `src-tauri/*` | native window and notification permission | agent logic |

### 3.4 Architectural paradigms

**1. Local-first architecture**

All durable state is in `~/.local/share/minimi/minimi.db` (platform equivalent; `MINIMI_DATA_DIR` overrides). Uploaded files and the embedding cache also live under that directory. The app works without an account or cloud service. The trade-off is that the process itself is the availability boundary.

**2. Client/server trust boundary**

The browser never sees provider keys. Keys are stored in SQLite and used only by the Node process. This is why the app is not browser-only: a pure client app would expose keys and make PDF/DOCX extraction and local vectors harder.

**3. Streaming-first interaction**

`streamText` is converted to an AI SDK UI message stream. Text, reasoning, tool inputs, tool outputs, and sources arrive incrementally. Persistence and background enrichment happen after or alongside streaming; they are never on the critical path to the first token.

**4. Agentic tool loop**

The model is not asked to answer from memory alone. It runs inside a bounded tool loop (`stepCountIs(maxSteps)`, default 8) with search, page fetch, memory recall, reminder creation, and reminder updates. Tool results return to the same model turn.

**5. Retrieval-augmented generation, hybrid by design**

Memory recall combines three signals:

- vector similarity over durable memories,
- FTS5 keyword search over raw messages,
- explicit date-range scans over user messages.

The merge is a reciprocal-rank-style score. This is deliberately hybrid because vector similarity handles paraphrase, while FTS and date scans handle exact names and "what did I ask last Tuesday" questions.

**6. Provider adapter / seam**

The AI SDK `LanguageModel` is the provider seam. `server/agent/providers.ts` maps stored provider config to OpenAI, Anthropic, Google, OpenRouter, Ollama, or an OpenAI-compatible endpoint. Business logic never branches on vendor except when constructing the adapter.

**7. Precomputed reminder events**

Reminders are not only rows with a due date. Each active reminder has immutable scheduled **events**. This makes firing idempotent and lets the scheduler recover missed ticks. The unique key `(reminder_id, kind, scheduled_for)` prevents duplicate nudges. The trade-off is extra rows and the need to resync events when a reminder changes.

**8. Idempotency and deduplication**

- Reminder events are unique by kind and scheduled time.
- A source message can create at most one active reminder.
- An identical active reminder in the same session is treated as a duplicate.
- Search results are deduplicated by canonical URL.
- Sources are numbered once after deduplication.
- Notification claims mark `notified_at` so two polls cannot deliver the same event twice.

**9. Graceful degradation and bounded work**

Every expensive subsystem has a timeout or budget:

- automatic memory recall: 2.5 s,
- search provider: 12 s,
- page extraction: up to 3 pages, 9 s per page, 2.5 MB cap,
- title generation: 12 s,
- reminder extraction: 15 s,
- model retries: 1,
- chat context: last 40 messages,
- tool steps: 8.

If embeddings fail, FTS still works. If page enrichment fails, snippets remain. If a provider fails, the UI gets a retry card with the real error.

**10. Single-user SQLite and minimal migrations**

WAL mode gives reliable local reads/writes. Migrations are small `ALTER TABLE` checks in `server/db/index.ts` because there is one user and one process. This would need a real migration system for a hosted product.

### 3.5 End-to-end chat flow

```text
Composer
  → POST /api/chat with UIMessage[]
  → persist user message immediately
  → recall memories (2.5 s best effort)
  → load attachments + active reminders
  → build date-aware system prompt
  → streamText with tools
  → stream text/reasoning/tool events to UI
  → persist assistant message on end
  → background: title generation (parallel), memory extraction, reminder fallback
  → client refreshes sessions and reminders
```

The title task starts first and in parallel with memory/reminder extraction so a new chat does not wait behind slower background work before receiving its name.

## 4. Low-level design (LLD)

### 4.1 Data model

SQLite in WAL mode is the whole state. The schema is defined in `server/db/schema.ts`.

| Table | Important columns | Purpose |
| --- | --- | --- |
| `sessions` | `id`, `title`, `title_locked`, `title_turn`, `pinned`, `archived`, `provider_id`, `model`, timestamps | chat list and per-chat model choice |
| `messages` | `id`, `session_id`, `role`, `content`, `parts_json`, `metadata_json`, `usage_json`, `error` | full UI messages and assistant metadata |
| `messages_fts` | `content`, `message_id`, `session_id`, `role`, `created_at` | FTS5 keyword and date lookup |
| `memories` | `id`, `session_id`, `message_id`, `kind`, `text`, `event_date`, `reminder_id` | durable extracted facts and tasks |
| `vec_memories` | `memory_id`, `embedding float[384]`, mirrored fields | sqlite-vec similarity search |
| `files` | `id`, `session_id`, `name`, `mime`, `size`, `path`, `extracted_text` | uploaded files and extracted text |
| `reminders` | `id`, `session_id`, `title`, `notes`, `url`, `due_date`, `due_time`, `timezone`, `status`, `source_message_id` | user-visible reminder rows |
| `reminder_events` | `id`, `reminder_id`, `kind`, `scheduled_for`, `status`, `fired_at`, `notified_at` | idempotent notification schedule |
| `providers` | `id`, `type`, `name`, `base_url`, `api_key`, `default_model`, `enabled`, `config_json` | model provider configuration |
| `search_cache` | `query_hash`, `query`, `results_json`, `fetched_at` | short-lived search result cache |
| `settings` | `key`, `value` | local preferences and app behavior |
| `schema_meta` | `key`, `value` | schema/version metadata |

Relationships:

- `sessions` 1:N `messages` with `ON DELETE CASCADE`.
- `sessions` 1:N `reminders` with `ON DELETE SET NULL`; deleting a chat keeps the reminder.
- `reminders` 1:N `reminder_events` with `ON DELETE CASCADE`.
- `memories` logically belong to sessions and optionally point at source messages and reminders.
- Each memory may have one `vec_memories` row with the same id.

`reminder_events.status` is one of `pending`, `fired`, `skipped`, or `cancelled`. A fired event is not the same as a delivered notification: `notified_at` is set only when a client claims it.

### 4.2 HTTP API

All routes are under `/api`. CORS only allows Vite/Tauri origins plus `MINIMI_ALLOWED_ORIGINS`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | process health and data directory |
| GET | `/bootstrap` | providers, settings, embedding/memory status, active reminder count |
| GET | `/sessions` | list/search sessions |
| POST | `/sessions` | create a session |
| GET | `/sessions/:id` | session plus messages |
| PATCH | `/sessions/:id` | rename, pin, archive, change model |
| DELETE | `/sessions/:id` | delete session and messages |
| POST | `/chat` | stream an agent response |
| POST | `/files` | multipart upload |
| GET | `/files/:id` | serve an uploaded file |
| DELETE | `/files/:id` | delete a file record and file |
| GET | `/reminders` | active/done reminders with recent events |
| POST | `/reminders` | create a reminder manually |
| PATCH | `/reminders/:id` | edit, complete, or reopen |
| DELETE | `/reminders/:id` | delete reminder and events |
| GET | `/reminder-events/pending` | atomically claim fired, undelivered events |
| GET | `/providers` | list public provider config |
| PATCH | `/providers/:id` | update provider |
| POST | `/providers` | add a custom provider |
| DELETE | `/providers/:id` | delete provider |
| POST | `/providers/:id/test` | test a provider/model |
| GET | `/settings` | read settings |
| PATCH | `/settings` | update editable settings |
| GET | `/memory` | memory stats and recent memories |
| DELETE | `/memory` | clear memories |
| POST | `/memory/rebuild` | re-extract/embed from history |
| GET | `/export` | JSON backup excluding API keys |
| POST | `/import` | restore sessions, messages, memories, reminders, settings |
| POST | `/data/clear` | delete conversations, files, memories, reminders, cache |

`GET /api/reminders` returns the last three events per reminder for display. The full schedule remains in SQLite and is used by the scheduler.

### 4.3 Chat request lifecycle

1. The client sends a `UIMessage[]`, optional `sessionId`, provider/model IDs, and attachment IDs.
2. The server creates a session if needed, upserts incoming messages, and resolves the model through `resolveSessionModel`.
3. `prepareAgentRun`:
   - extracts the last user text,
   - loads attachment text,
   - calls `recallMemories` with a 2.5 s timeout,
   - loads up to 12 active reminders,
   - builds the system prompt with date, timezone, memories, files, reminders, and user name,
   - creates tools with session and source-message context,
   - converts the last 40 messages to model messages,
   - starts `streamText` with `stepCountIs(maxSteps)`, temperature 0.4, one retry.
4. The stream is converted to a UI message stream. The client renders text, reasoning, tools, and sources as they arrive.
5. `onEnd` persists the assistant message. If it was not aborted and has text:
   - start title generation immediately and keep the promise,
   - extract durable memories,
   - run reminder fallback extraction if the source message has no reminder,
   - await the title promise.
6. Errors in background work are logged; they never turn a completed chat into a failure.

### 4.4 Agent loop and tools

`server/agent/tools.ts` exposes five tools:

| Tool | Logic | Typical use |
| --- | --- | --- |
| `web_search` | expand queries, search providers, dedupe, enrich pages, number sources, cap 9,000 characters | current facts, pricing, releases, "what changed" |
| `fetch_url` | safe page fetch and Readability extraction, cap 9,000 characters | read a specific page or user-supplied URL |
| `recall_memory` | hybrid recall with optional ISO date range | earlier chats, decisions, lists, preferences |
| `create_reminder` | validate, dedupe, create, precompute events, mirror memory | explicit future commitment |
| `update_reminder` | resolve by id or unique title, validate, reschedule, stop or reopen | move, rename, reschedule, cancel, complete |

The system prompt tells the model when each tool is mandatory: verify anything that could have changed, recall first for past-conversation questions, cite with `[S1]`, never invent URLs, and confirm reminder creation briefly.

### 4.5 Search pipeline

1. **Expand** — a model call produces up to three queries. Trivial short queries skip expansion to save latency. Timeout: 6 s.
2. **Resolve provider** — DuckDuckGo by default; Tavily or Brave if selected and keyed.
3. **Cache** — SHA-256 key over provider, freshness, result count, normalized query, and conversation-context hash. TTL default: 180 minutes.
4. **Search** — expanded queries run in parallel; each result set is merged into a URL-keyed map.
5. **Deduplicate** — strip fragments and query strings for the dedupe key.
6. **Enrich** — up to three pages, 9 s each, 2.5 MB response cap, Readability extraction, text budget shared across results.
7. **Date extraction** — OpenGraph/article metadata, `<time datetime>`, JSON-LD (`datePublished`, `dateCreated`, `uploadDate`), and search-engine timestamps.
8. **Cite** — assign `S1…Sn` after dedupe and reuse those labels in prompt, tool output, UI cards, and the final answer.

The extractor blocks private, loopback, link-local, and `.local` hosts and follows redirects manually so every hop is re-checked. This is an SSRF control, not a full browser sandbox.

### 4.6 Memory pipeline

**Write path**

After a turn, `extractMemoriesForTurn` asks the model for up to four durable items: preferences, decisions, facts, entities, commitments, and corrections. Greetings, filler, generic knowledge, and the assistant's own reasoning are rejected. Each memory gets a `kind`, optional `event_date`, session, and source message.

Memories require embeddings to be saved. `saveMemories` embeds passages locally and writes both the relational row and the 384-dimension vector row. If embedding fails, the chat still succeeds but the memory is not stored.

Reminders are also mirrored into memory as tasks. `syncReminderMemory` keeps that memory aligned when a reminder is created, edited, completed, or deleted.

**Read path**

`recallMemories` merges:

- vector search: 24 nearest memories,
- FTS5: 24 matching messages,
- date scan: up to 60 user messages when `from`/`to` are supplied.

Scores use `1 / (60 + rank)` and are summed per hit. Results are sorted and capped at 10 by default, 6 for automatic prompt injection, and 14 for the agent tool. Session titles are joined for display.

**Rebuild**

`POST /api/memory/rebuild` re-embeds user turns after an embedding model change. This is a repair path, not part of normal chat.

### 4.7 Reminders and notifications

**Creation paths**

- The `create_reminder` agent tool.
- The manual add/edit dialog.
- A fallback extractor after a turn when the user message has explicit reminder language or a commitment plus a time/date expression.

**Validation**

- title: trimmed, 2–160 characters,
- date: real local `YYYY-MM-DD`,
- time: optional local `HH:MM`,
- URL: optional `http(s)` only,
- timed reminders must not be more than 60 s in the past,
- all-day reminders are allowed today because they are valid until the end of the day.

**Deduplication**

- `source_message_id` prevents a retry from creating a second reminder for the same user message.
- An identical active reminder in the same session (same title, date, and time) is reused instead of duplicated.

**Schedule**

| Reminder type | Events |
| --- | --- |
| Timed | one `time_due` event at the local due date/time |
| All-day | `day_hour` events every 2 hours from 09:00 through 21:00 local |

The schedule is precomputed by `buildReminderSchedule`. `(reminder_id, kind, scheduled_for)` is unique. Editing a reminder deletes pending events, keeps fired/skipped history, and generates the new schedule. Completing a reminder cancels pending events.

**Engine**

`server/reminders/engine.ts` runs a 15-minute tick. On startup it resyncs active reminders to the current rules, then runs a tick immediately. `fireDueEvents`:

- marks pending events older than 30 minutes as `skipped`,
- marks pending events due within the last 30 minutes as `fired`.

The 30-minute grace is larger than the tick interval, so a normal 15-minute tick cannot miss a valid event.

**Client delivery**

The client polls `/api/reminder-events/pending` every 15 seconds while notifications are enabled. The endpoint atomically claims fired, unnotified events whose `fired_at` is within the last 10 minutes and marks `notified_at`, so two tabs cannot deliver the same event twice. Older fired events are left undelivered rather than replayed. The app then:

1. shows a Tauri or browser system notification when permission is granted,
2. otherwise shows an in-app sonner toast with an optional "Open chat" action,
3. refreshes reminder state.

A bell in the top-right opens a right-side notification drawer. The drawer lists active reminders sorted by date and time; it does not split them into time/day queues. Each row supports done, edit, open link, and open source chat.

### 4.8 Automatic chat titles

New chats start as `New chat`.

- After the first completed assistant response, the title task starts **immediately** and in parallel with memory/reminder extraction.
- A model call sees the current title and the last six messages and returns a 2–6 word title plus a `rename` decision.
- If the model fails or returns an empty title, a deterministic fallback derives a short title from the first user message, so a new chat does not stay unnamed.
- Later turns are reconsidered every six user turns, or immediately when the title is still the default.
- The client refreshes sessions at 2.5 s, 9 s, and 20 s after stream completion to display the new title.
- If the user manually renames a chat, `title_locked` is set and auto-titling stops permanently for that chat.
- `chat.autoTitle=0` disables the behavior.

### 4.9 Files

Uploads are capped at 25 MB and stored under the data directory with 0600 permissions.

| Type | Extraction |
| --- | --- |
| PDF | `pdf-parse` |
| DOCX | `mammoth` raw text |
| text, markdown, CSV, JSON, YAML, XML, HTML, and common source-code extensions | UTF-8 text |

Extracted text is injected into the system prompt for that run. Unsupported or failed extraction still allows the file to exist, but contributes no text. Files can be deleted individually or through data clear.

### 4.10 Frontend state and rendering

`App.tsx` owns:

- bootstrap data,
- session list and active session,
- chat reset key,
- settings and delete dialogs,
- reminder list, add/edit dialog state,
- notification polling and system/toast delivery.

`ChatPage` owns the per-chat transport and composer state. The `DefaultChatTransport` reads session, provider, model, and attachment IDs from refs so changing a selector does not recreate the transport mid-send. A new chat has no session; the client creates one and sends the first message in the same turn.

Rendering is part-based:

- markdown and code blocks,
- collapsed reasoning,
- tool cards,
- source grid with dates and labels,
- inline error card with retry and provider settings.

The reminder drawer is a Coss/Base UI right-side drawer. The notification bell lives in the chat header next to Settings.

### 4.11 Tauri and production

Tauri uses the same frontend and API. The native layer provides:

- the desktop window,
- URL opening,
- notification permission and delivery through `tauri-plugin-notification`.

Browser fallbacks are explicit. In production the Node server must be running; bundling it as a Tauri sidecar remains future work.

### 4.12 Configuration and settings

Environment variables:

| Variable | Meaning |
| --- | --- |
| `MINIMI_HOST` | API bind host, default `127.0.0.1` |
| `MINIMI_PORT` | API port, default `8787` |
| `MINIMI_DATA_DIR` | override data directory |
| `MINIMI_ALLOWED_ORIGINS` | extra CORS origins |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google; aliases `GOOGLE_AI_STUDIO_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY` |
| `OPENROUTER_API_KEY` | OpenRouter |
| `BRAVE_API_KEY` | Brave Search |
| `TAVILY_API_KEY` | Tavily Search |

Provider defaults include `gemini-3.5-flash` and `openrouter/free`. Environment keys are adopted into existing provider rows on startup when the row has no key.

Important settings:

- `search.provider`, `search.maxResults`, `search.cacheTtlMinutes`,
- `memory.enabled`, `memory.autoExtract`,
- `chat.maxSteps`, `chat.autoTitle`,
- `notifications.enabled`,
- `app.theme`, `app.language`,
- local user profile fields.

### 4.13 Security, failure, and limits

- The API binds to `127.0.0.1` by default.
- CORS is restricted to the Vite/Tauri origins and explicit overrides.
- API keys never leave the server except in provider requests.
- Exports exclude keys.
- Page fetches block private/loopback/link-local hosts and re-check every redirect.
- Keys are plaintext in SQLite; acceptable for a single-user local app, not for a hosted one.
- Background failures are isolated: memory, reminders, titles, and search enrichment cannot corrupt the chat response.
- Search text, tool steps, context, and file sizes are bounded to keep latency and prompt size predictable.

## 5. Codebase map

```text
server/
  index.ts              Hono routes, SSE chat, import/export, scheduler startup
  config.ts             paths, host/port, embedding constants
  provider-env.ts       env-key aliases per provider
  embeddings.ts         local fastembed load/query/passage embedding
  memory.ts             memory extraction, hybrid recall, rebuild, reminder sync
  file-store.ts         upload, safe naming, PDF/DOCX/text extraction
  agent/
    prompt.ts           date-aware system prompt and tool instructions
    providers.ts        provider/config -> AI SDK LanguageModel
    run.ts              context assembly, memory recall, streamText setup
    tools.ts            web_search, fetch_url, recall_memory, create/update_reminder
    title.ts            first-chat and periodic auto-title generation
  search/
    index.ts            expansion, cache, provider selection, dedupe, sources
    ddg.ts              DuckDuckGo/Tavily/Brave adapters
    extract.ts          safe fetch, Readability, date metadata, SSRF checks
    signal.ts           combined abort/timeout signals
  reminders/
    schedule.ts         validation, local date/time, event generation
    service.ts          create/update rules, dedupe, resolve by id/title
    extract.ts          explicit-phrase fallback extraction
    engine.ts           15-minute scheduler and startup resync
  db/
    schema.ts           tables, indexes, FTS5, vec0, provider defaults
    index.ts            connection, migrations, settings, env-key adoption
    sessions.ts         session CRUD, title lock, user-turn count
    messages.ts         message CRUD, text extraction, FTS search
    files.ts            file records
    memories.ts         memory rows, vector search, reminder links
    reminders.ts        reminder/event DAO, firing, claiming, resync
    providers.ts        provider CRUD and usable-provider selection
    types.ts            shared server types
src/
  App.tsx               top-level state, notification polling, dialogs
  components/chat/      composer, message parts, tools, sources
  components/reminders/ drawer, item, add/edit dialog
  components/settings/  providers, search, agent, notifications, data
  components/app-sidebar.tsx  search, pinned/recent sessions, settings
  lib/api.ts            typed API client
  lib/types.ts          shared frontend types
  lib/reminders.ts      due labels, active sorting, nudge copy
  lib/notifications.ts  permission and system notification helpers
  lib/models.ts         model suggestions and provider colors
  hooks/                composer editor and media-query hooks
src-tauri/
  src/lib.rs            window setup, opener and notification plugins
  capabilities/         Tauri permissions
```

## 6. Feature logic map

| Feature | Logic | Primary code |
| --- | --- | --- |
| Streaming chat | persist user message, build prompt, stream model/tool events, persist assistant | `server/index.ts`, `server/agent/run.ts`, `src/components/chat/*` |
| Live web verification | expand query, search, dedupe, enrich, date, cite | `server/search/*`, `web_search` tool |
| Read a URL | safe fetch, Readability, date extraction, 9,000-character cap | `server/search/extract.ts`, `fetch_url` tool |
| Long-term memory | extract facts, embed locally, store vector + row | `server/memory.ts`, `server/db/memories.ts` |
| Recall | vector + FTS + date scan, reciprocal-rank merge | `server/memory.ts`, `recall_memory` tool |
| Reminder creation | tool or fallback, validate, dedupe, event schedule, memory mirror | `server/agent/tools.ts`, `server/reminders/*` |
| Reminder notifications | 15 min engine -> fired events -> client claim -> system/toast | `server/reminders/engine.ts`, `src/App.tsx` |
| Notification drawer | bell in header, right-side drawer, active reminders sorted | `src/components/reminders/*`, `chat-page.tsx` |
| Auto titles | first assistant response, parallel task, fallback, 6-turn refresh, lock | `server/agent/title.ts`, `server/index.ts`, `chat-page.tsx` |
| File reading | 25 MB cap, PDF/DOCX/text extraction, prompt injection | `server/file-store.ts`, `/api/files` |
| Providers | adapter per type, env-key aliases, test connection | `server/agent/providers.ts`, `server/provider-env.ts` |
| Sessions | list/search/pin/rename/delete, cascade messages | `server/db/sessions.ts`, `app-sidebar.tsx` |
| Export/import | JSON without keys, reminders/events included | `server/index.ts` |
| Theme | light/dark/system, localStorage + settings | `src/lib/theme.tsx`, settings |
| Desktop | Tauri webview, opener, notifications | `src-tauri/*`, `src/lib/notifications.ts` |

## 7. Trade-offs and rejected alternatives

- **LangChain or another agent framework** — hides prompt and tool semantics behind abstractions; this loop is small enough to own and debug directly.
- **Cloud vector database** — adds cost, latency, and a network dependency to a local-first app.
- **Embed every message** — slower and noisier than durable facts plus FTS.
- **Browser-only app** — exposes keys, complicates file extraction, and prevents local embeddings and a reliable background scheduler.
- **Always expand search queries** — a model call for every trivial question; expansion is skipped for short simple queries.
- **Headless browser scraping** — better on JS-heavy pages but slow and fragile; Readability on raw HTML is the better cost/quality point here.
- **Rust agent loop in Tauri** — duplicates the most important code and doubles the test surface.
- **Scan reminders directly on every tick** — possible, but precomputed events make idempotency, retries, and missed ticks much easier to reason about.
- **Store full page text forever** — database bloat and stale evidence; only current tool output and extracted file text are kept.
- **Closed-app reminders** — would require an OS service or Tauri background process; deliberately out of scope.

## 8. Verification and operational notes

The project is verified with:

```bash
bunx tsc --noEmit
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run dev
```

Manual smoke tests cover:

- provider test and real streaming with Google and OpenRouter,
- first-chat title generation and manual title lock,
- reminder create/edit/done through both chat tool and UI,
- event counts for timed and all-day reminders,
- forced scheduler tick, pending-event claim, and duplicate-claim prevention,
- toast and drawer rendering at desktop and mobile widths,
- export/import round trip with reminders,
- production static serving from `npm start`.

Known limitations:

- notifications require the Node server and client to be running,
- the Tauri production bundle does not yet start the Node server,
- the frontend bundle is large because markdown, syntax highlighting, and Mermaid are bundled together,
- `generateObject` emits an AI SDK deprecation warning but remains functional.

## 9. Future work

1. Add an evaluation set for time-sensitive questions scored on citation correctness and "what changed" completeness.
2. Add recency-aware ranking and duplicate-story clustering.
3. Make inline `[S1]` citations clickable.
4. Stream search queries as they are issued, not only when the tool returns.
5. Add provider fallback and remote model presets.
6. Package the Node server as a Tauri sidecar and use the OS keychain for secrets.
7. Support reminders that survive a closed app.
8. Add a memory quality loop: "forget this", duplicate merging, and preview before saving.

The biggest open question is evidence quality, not architecture. DuckDuckGo HTML is free and good, but not every result exposes a date and some publishers block extraction. The date parser, snippet fallback, and explicit "undated" instruction are the current mitigations; a paid search API or browser fetcher is the next lever.
