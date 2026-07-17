# Changelog

## 3.0.0

### Added

- Local-first command execution inside SillyTavern
- Action Registry and serialized Action Queue
- Queue cancellation, timeout, history, and result inspection
- Local, Hybrid, and Bridge operating modes
- Remote permission scopes
- Optional Bearer authentication token
- Bridge capability registration using protocol `kesatria/3`
- Remote request deduplication
- Exponential reconnect backoff
- Floating responsive Command Center UI
- Draggable launcher with persisted position
- Searchable command palette and `Ctrl/Command + K` shortcut
- Activity audit trail
- Reduced-motion setting
- New actions for status, last response, save, reload, continue, regenerate, and stop

### Changed

- UI-originated commands no longer submit to `/submit` and wait to be polled back
- Bridge polling is now sequential, abortable, timeout-aware, and backoff-enabled
- Remote generic actions are rejected unless explicitly registered
- Session IDs use `crypto.randomUUID()` when available
- Code is split into core and adapter modules

### Compatibility

Legacy remote action names remain mapped to the v3 registry:
`send_message`, `get_chat_history`, `get_character_info`, `get_chat_list`, and `generate`.
