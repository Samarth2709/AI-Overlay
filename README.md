## AI Assistant (macOS overlay + local backend)

A minimal, fast macOS AI assistant you can summon with a global hotkey. Press the hotkey and an always-on-top overlay appears so you can chat with an AI model. The macOS app focuses on instant UI responsiveness; a separate local backend handles model calls and streaming.

### Goals
- **Speed-first UX**: near-instant overlay, no jank. Preload window and keep it alive.
- **Separation of concerns**: macOS app for UI + hotkey; backend for model logic.
- **Local-first**: backend runs on `localhost` for low latency and privacy. TEMPORARILY
- **Stream-ready**: backend designed to support streaming responses.

### High-level Architecture
- **frontend-macos**: SwiftUI/AppKit app that registers a global hotkey and toggles a lightweight overlay (`NSPanel`) containing a minimalist chat UI. Talks to the backend over HTTP.
- **backend**: Node.js server exposing REST endpoints. Proxies to OpenAI, Gemini, and Grok, returns results. Supports a configurable system prompt file.
- **frontend (CLI)**: Simple Node CLI to verify the backend end-to-end via terminal.

### Project Structure
```
AI-Assistant/
├─ README.md
├─ .gitignore
├─ backend/
│  ├─ package.json
│  └─ src/
│     ├─ server.js
│     ├─ lib/
│     │  ├─ conversationStore.js
│     │  └─ openaiClient.js
│     ├─ prompts/
│     │  └─ helper-systemprompt.txt
│     └─ routes/
│        ├─ chat.js
│        └─ conversations.js
├─ frontend/
│  ├─ package.json
│  └─ src/
│     └─ cli.js
└─ frontend-macos/
   ├─ Package.swift
   └─ Sources/
      └─ AIAssistantApp/
         ├─ AIAssistantApp.swift
         ├─ ContentView.swift
         ├─ HotkeyManager.swift
         └─ OverlayWindow.swift
```

### Current Frontend (macOS Overlay)
- **Hotkey**: Option+Space toggles overlay visibility.
- **Hide**: Esc hides the overlay.
- **Window**: Always-on-top, resizable, rounded, thin bordered, blurred background.
- **Header**: Full-width bar with title, a dropdown menu (Default/Creative/Precise/Fast, placeholder), and a New Chat button.
- **Chat**:
  - One-line, compact input pill; press Enter to send.
  - Messages render as modern bubbles (user right-aligned, assistant card-like).
  - Autoscrolls to newest message.
- **Networking**: Sends messages to the backend; maintains `conversationId` across turns.

### Backend
- **Runtime**: Node 18+
- **Provider**: OpenAI (now), pluggable for other providers later.
- **Conversation**: Hybrid in-memory cache + persistent SQLite; TTL cache 2h (in-memory), DB retained longer.
- **System prompt**: Loads a file and prepends as a `system` message.
  - Default: `backend/src/prompts/helper-systemprompt.txt`
  - Override: `SYSTEM_PROMPT_PATH=/absolute/path/to/prompt.txt`

#### Env Vars
- `OPENAI_API_KEY` (or `OPENAIAPI_KEY`) – required for OpenAI
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY` / `GENERATIVE_LANGUAGE_API_KEY`) – required for Gemini
- `OPENAI_MODEL` – optional, default `gpt-4o-mini`
- `SYSTEM_PROMPT_PATH` – optional path to a prompt file
- `PORT` – default `7071`

#### Run the backend
```bash
cd backend
npm install
npm run dev
```

#### Database (SQLite)
- **Driver**: `better-sqlite3` (synchronous, fast, safe in a single Node process)
- **Location**: `backend/data/conversations.db` (configurable via `DATABASE_PATH`)
- **WAL mode**: Enabled for reliability and concurrent readers
- **Hybrid storage**: In-memory cache for hot conversations; SQLite for durability and history

Schema overview:
- **`conversations`**
  - `id` TEXT PRIMARY KEY
  - `created_at` INTEGER
  - `updated_at` INTEGER
  - `title` TEXT NULL
  - `model` TEXT NULL (last used)
  - `provider` TEXT NULL (last used)
  - `metadata` TEXT NULL (JSON)
- **`messages`**
  - `id` INTEGER PRIMARY KEY AUTOINCREMENT
  - `conversation_id` TEXT REFERENCES `conversations`(`id`) ON DELETE CASCADE
  - `role` TEXT CHECK IN ('user','assistant','system')
  - `content` TEXT
  - `created_at` INTEGER
  - `model` TEXT NULL
  - `provider` TEXT NULL
  - `usage_prompt_tokens` INTEGER DEFAULT 0
  - `usage_completion_tokens` INTEGER DEFAULT 0
  - `usage_total_tokens` INTEGER DEFAULT 0
  - `metadata` TEXT NULL (JSON)

Standardized conversation shape returned by the API and store:
```json
{
  "chatId": "c_ab12cd34kq1xz",
  "createdAt": 1735439245123,
  "updatedAt": 1735439250444,
  "chatHistory": [
    { "role": "user", "content": "hello", "at": 1735439245123 },
    { "role": "assistant", "content": "hi, how can i help?", "at": 1735439247000, "model": "gpt-4o-mini", "provider": "openai", "usage": { "prompt_tokens": 3, "completion_tokens": 8, "total_tokens": 11 } }
  ]
}
```

Notes:
- The cache TTL is ~2h; older entries are evicted from memory, but SQLite retains data longer (cleanup runs separately).
- Set `DATABASE_PATH` to relocate the DB (e.g., to an external drive or app data dir).
- Backups: copy the three files together if present: `conversations.db`, `conversations.db-wal`, `conversations.db-shm`.
- Reset DB: stop the server and delete `backend/data/` (or the file at `DATABASE_PATH`). It will be recreated on next start.

### CLI Frontend (for backend verification)
```bash
cd frontend
npm install
node src/cli.js              # interactive mode
node src/cli.js "hello"      # one-shot
# Optional env
CONVERSATION_ID=<id> node src/cli.js
API_BASE_URL=http://127.0.0.1:7071 node src/cli.js
```
- Interactive commands: `/new` to start a new conversation, `/exit` to quit.

### macOS Overlay App
#### Build and run (SwiftPM)
```bash
cd frontend-macos
swift build
swift run
```
- Toggle overlay: Option+Space
- Hide overlay: Esc or Option+Space
- Send: Enter or the Send button
- Refresh last AI answer: click the clockwise arrow on an assistant bubble

### API Contract
- **Create Conversation**
  - `POST /v1/conversations`
  - Response: `{ "conversationId": string }`

- **Get Conversation**
  - `GET /v1/conversations/:id`
  - Response: `{ "conversationId": string, "conversation": { "chatId": string, "createdAt": number, "updatedAt": number, "chatHistory": Array<...> } }`

- **List Conversations**
  - `GET /v1/conversations?limit=50&offset=0`
  - Response: `{ "conversations": Array<ConversationRow>, "stats": { "conversations": number, "messages": number, "databaseSize": number }, "pagination": { "limit": number, "offset": number } }`

- **Delete Conversation**
  - `DELETE /v1/conversations/:id`
  - Response: `{ "conversationId": string, "deleted": true }`

- **Chat**
  - `POST /v1/chat`
  - Body: `{ "message": string, "conversationId"?: string, "model"?: string }`
  - Response: `{ "conversationId": string, "model": string, "response": string, "usage": { ... }, "conversation": { ...standardized shape... } }`
  - Behavior: Prepends `system` message from the configured prompt file (if present).
  - Models:
    - OpenAI: e.g. `gpt-4o-mini` (default)
    - Gemini: `gemini-2.5-pro`, `gemini-2.5-flash`
    - Grok: `grok-4`

- **Refresh AI Response**
  - `POST /v1/chat/refresh` (SSE streaming)
  - Body: `{ "conversationId": string, "model"?: string }`
  - Behavior:
    - Removes the most recent assistant message from the conversation (if present)
    - Re-sends the conversation history up to the last user message to the selected model
    - Streams a brand-new assistant response without echoing the previous assistant message
  - SSE events:
    - `init`: `{ conversationId, model }`
    - `token`: `{ token }` – incremental text chunks
    - `done`: `{ conversationId, model, usage, text, conversation }`
    - `error`: `{ error }`

### Streaming
- Backend exposes `GET /v1/chat/stream` and `POST /v1/chat/refresh` (both SSE `text/event-stream`) for incremental tokens.
- Providers:
  - OpenAI: native streaming via Chat Completions.
  - Gemini: native streaming; backend relays tokens as SSE. For a smoother UX, Gemini tokens are forwarded word-by-word with tiny delays.
  - Grok (xAI): OpenAI-compatible streaming via `stream: true`.
- Frontend (Swift): consumes SSE with `URLSession.bytes`, parsing `data:` lines and appending tokens.
 - Final `done` event includes the standardized `conversation` snapshot.

#### Logging
- Backend logs are written to `backend/logs/backend.log` (rotated by process restarts).
- To change log level: set `LOG_LEVEL` env (default `info`).
- The `backend/logs/` directory is git-ignored by default.

### Troubleshooting
- If the overlay doesn’t accept typing, ensure it’s launched and focused; the app uses an activating `NSPanel` and `makeKeyAndOrderFront`.
- If the backend returns errors, verify `OPENAI_API_KEY` is set (or `OPENAIAPI_KEY`) and that the model name is valid.
- System prompt not applied? Check `SYSTEM_PROMPT_PATH` and file readability, then restart backend.

### Security & Privacy
- Keep API keys only in backend `.env` (never in the macOS app).
- If you use local models, the backend can run fully offline.

### TODO
- MAke the ai responses formatted properly with latex formatting
- Make the overlay stay in the same place it was last placed to. 
- Make a visualizer for the database.
- Make a switch modes option so the user can switch between system prompts. 
- Make a edit feature so the user can edit ANY of their messages (only user messages)
- Add screensharing capabilities

### Roadmap Ideas
- Wire dropdown options to backend parameters (style, model, temperature).
- Streaming responses and token-by-token UI.
- Clipboard insertion / per-app context injection.
- Attachments, screenshot-to-text, and RAG.
- Conversation history with local SQLite.
- Hotkey editor UI and per-profile hotkeys.

### License
MIT

# Custom Fonts

The app uses custom fonts bundled as resources. The current font is Tektur, but it's designed to support adding more fonts easily.

### How Fonts Are Loaded
- Fonts are copied from `Sources/AIAssistantApp/fonts/[FontName]/static/*.ttf`
- At app launch, `FontRegistrar.registerAllCustomFonts()` registers all `.ttf` files in "fonts" and subdirectories using CoreText
- In the UI (`ContentView.swift`), use `.custom("FontFamily", size: ...).weight(...)` to apply

### Adding a New Font
1. Add the font files to `Sources/AIAssistantApp/fonts/[NewFontName]/static/*.ttf` (or adjust structure)
2. Rebuild the app (`swift build`)
3. Update `ContentView.swift` to use the new font family name (check family name with Font Book or fc-query)
4. Run the app and check the console for registration logs

Example: To add "Montserrat", add the ttf files to `fonts/Montserrat/static`, rebuild, and change `.custom("Tektur", ...)` to `.custom("Montserrat", ...)` in ContentView.

The registration is automatic for all ttf files in the fonts directory, so no code change needed for registration.
