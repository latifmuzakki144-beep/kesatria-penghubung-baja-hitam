# ⚔️ Kesatria Penghubung Baja Hitam

**Local-first SillyTavern Command Center with an optional Hermes/OpenClaw bridge.**

Kesatria v3 turns the extension from a bridge monitor into a command layer for SillyTavern. Commands started inside SillyTavern run locally and no longer travel to the bridge and back. Hermes/OpenClaw can still use the same action system remotely when bridge mode is enabled.

## Highlights in v3.0.2

- Local-first commands that work without Hermes, OpenClaw, or a bridge server
- Shared Action Registry for local and remote capabilities
- Serialized Action Queue with status, cancellation, timeout, and history
- Hybrid, Local-only, and Bridge-only operating modes
- Remote permission scopes for read, write, generation, and save actions
- Bearer-token support for bridge requests
- Request deduplication and structured action responses
- Exponential reconnect backoff instead of a fixed failing poll loop
- Modern floating Command Center with desktop and mobile layouts
- Draggable launcher with persistent position
- Searchable command palette (`Ctrl/Command + K`)
- Activity audit trail and JSON result viewer
- Reduced-motion accessibility option
- Compatibility mapping for the original bridge action names

## Architecture

```text
SillyTavern UI ──► Action Registry ──► Action Queue ──► SillyTavern Adapter
                         ▲                    ▲
                         │                    │
Hermes / OpenClaw ─► Bridge Client ──────────┘
```

Local and remote requests use the same registered actions, permissions, timeout rules, queue, and result format.

## Available actions

| Action ID | Legacy bridge name | Description |
|---|---|---|
| `system.status` | `get_status`, `get_chat_list` | Read extension, chat, queue, and bridge status |
| `character.info` | `get_character_info` | Read the active character and persona |
| `chat.history` | `get_chat_history` | Read paginated chat history |
| `chat.last_response` | `get_last_response` | Read the newest assistant response |
| `chat.send_as_user` | `send_message` | Send directly through the SillyTavern composer |
| `generation.quiet` | `generate` | Run a private quiet prompt |
| `generation.continue` | `continue` | Trigger native continue generation |
| `generation.regenerate` | `regenerate` | Trigger native regenerate |
| `generation.stop` | `stop_generation` | Stop an active generation |
| `chat.save` | `save_chat` | Persist the active chat |
| `chat.reload` | — | Reload the active chat locally |

The availability of native continue/regenerate/stop controls depends on the installed SillyTavern version. Kesatria reports a clear error when a matching native control is unavailable.

## Installation

1. Open SillyTavern.
2. Open **Extensions**.
3. Choose **Install Extension**.
4. Paste:

```text
https://github.com/latifmuzakki144-beep/kesatria-penghubung-baja-hitam
```

5. Refresh SillyTavern.
6. Open the floating sword button or the extension settings entry.

## Operating modes

### Local only

Commands can be started from SillyTavern. The bridge cannot connect and remote requests are rejected.

### Hybrid

Local commands run directly while Hermes/OpenClaw can submit permitted remote commands. This is the recommended mode.

### Bridge only

The extension is controlled through the bridge. Local command execution is disabled by policy.

## Bridge setup

Configure these values in **Connection**:

- **Bridge URL** — base URL of the bridge server
- **Authentication Token** — optional Bearer token
- **Session ID** — generated with `crypto.randomUUID()` when available
- **Polling interval** — minimum 750 ms
- **Mode** — Local, Hybrid, or Bridge

The v3 registration payload includes protocol and capability information:

```json
{
  "protocol": "kesatria/3",
  "client": "sillytavern-extension",
  "mode": "hybrid",
  "capabilities": ["system.status", "chat.history", "chat.send_as_user"]
}
```

Existing bridge servers can continue sending the original action names. The extension maps those names to the v3 registry.

## Remote permissions

Remote permissions are independent from local commands:

- `system.read`
- `chat.read`
- `character.read`
- `chat.write`
- `generation.run`
- `generation.stop`
- `system.save`

Disabling a scope rejects matching remote requests before they reach SillyTavern.

## Project structure

```text
index.js
style.css
html/settings.html
src/
├── adapters/
│   ├── bridge-client.js
│   └── sillytavern-adapter.js
└── core/
    ├── action-queue.js
    ├── action-registry.js
    └── state-store.js
```

## Bridge endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/register` | POST | Register the session and capabilities |
| `/poll` | GET | Retrieve a pending action |
| `/response` | POST | Return a structured action result |
| `/health` | GET | Test bridge availability |

## Development notes

The extension has no build step. JavaScript files are native ES modules loaded by SillyTavern.

Basic syntax validation:

```bash
node --check index.js
node --check src/core/action-registry.js
node --check src/core/action-queue.js
node --check src/core/state-store.js
node --check src/adapters/bridge-client.js
node --check src/adapters/sillytavern-adapter.js
```

## Roadmap after v3.0

- WebSocket/SSE transport with polling fallback
- Confirmation policies for sensitive remote actions
- Per-character and group profiles
- Macros and multi-step workflows
- Chat search and context inspector
- Device pairing and revocation
- Additional tested SillyTavern actions

## License

MIT License. See [LICENSE](LICENSE).
