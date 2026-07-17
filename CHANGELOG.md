# Changelog

## v3.0.3
- Consolidated release of the v3.0.2 mobile-dialog-fix.
- Use a native `<dialog>` so the app opens above SillyTavern popups on mobile.
- Add a native mobile launcher beside the SillyTavern composer.
- Rebuild desktop, tablet, and mobile layout rules.
- Keep command sheets, result panels, and toasts inside the dialog top layer.
- Harden pointer/touch activation for the Open button.

## v3.0.2
- Use a native `<dialog>` so the app opens above SillyTavern popups on mobile.
- Add a native mobile launcher beside the SillyTavern composer.
- Rebuild desktop, tablet, and mobile layout rules.
- Keep command sheets, result panels, and toasts inside the dialog top layer.
- Harden pointer/touch activation for the Open button.

## v3.0.2
- Fix SillyTavern mobile portal mounting by attaching the UI under `<html>` instead of the fixed/clipped `<body>`.
- Force the launcher and modal above mobile drawers.
- Add pointer, touch, and click capture for the Open control.
- Re-mount the extension entry when SillyTavern rebuilds mobile drawer content.
- Export an idempotent `activate()` function while preserving automatic SillyTavern startup.

## v3.0.2
- Fix SillyTavern mobile compatibility for the Open button.
- Re-mount the command center UI when SillyTavern re-renders panels.
- Force the floating launcher to stay visible above mobile UI layers.
- Add direct click/touch handlers for the extension entry and launcher.

# Changelog

## 3.0.2

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
