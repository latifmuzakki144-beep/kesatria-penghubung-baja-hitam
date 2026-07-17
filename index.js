/**
 * ⚔️ Kesatria Penghubung Baja Hitam v3.0.0
 * Local-first SillyTavern Command Center with optional Hermes/OpenClaw bridge.
 */

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    generateQuietPrompt,
    saveChat,
    reloadCurrentChat,
} from '../../../../script.js';

import { extension_settings, getContext } from '../../../extensions.js';
import { ActionRegistry } from './src/core/action-registry.js';
import { ActionQueue } from './src/core/action-queue.js';
import { StateStore } from './src/core/state-store.js';
import { BridgeClient } from './src/adapters/bridge-client.js';
import { SillyTavernAdapter } from './src/adapters/sillytavern-adapter.js';

const EXTENSION_KEY = 'kesatria';
const EXTENSION_NAME = 'kesatria-penghubung-baja-hitam';
const VERSION = '3.0.0';
const ROOT_PATH = `scripts/extensions/third-party/${EXTENSION_NAME}`;
const MAX_ACTIVITY = 200;

function createSessionId() {
    if (globalThis.crypto?.randomUUID) return `session-${globalThis.crypto.randomUUID()}`;
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

const defaultSettings = {
    schemaVersion: 3,
    enabled: false,
    mode: 'hybrid',
    bridgeUrl: '',
    authToken: '',
    sessionId: createSessionId(),
    autoConnect: false,
    pollingInterval: 2000,
    debugMode: false,
    reducedMotion: false,
    launcherPosition: null,
    permissions: {
        'system.read': true,
        'chat.read': true,
        'character.read': true,
        'chat.write': true,
        'generation.run': true,
        'generation.stop': true,
        'system.save': true,
    },
};

const runtime = new StateStore({
    bridge: {
        status: 'offline',
        latency: null,
        lastError: '',
        connectedAt: null,
        pollCount: 0,
    },
    activity: [],
    queue: { active: null, pending: [], history: [] },
    activeTab: 'overview',
});

let registry;
let queue;
let bridge;
let sillyTavern;
let pendingDialogAction = null;
const processedRemoteRequests = new Map();

function settings() {
    return extension_settings[EXTENSION_KEY];
}

function migrateSettings() {
    const current = extension_settings[EXTENSION_KEY] || {};
    const migrated = {
        ...defaultSettings,
        ...current,
        permissions: {
            ...defaultSettings.permissions,
            ...(current.permissions || {}),
        },
    };

    if (!migrated.sessionId) migrated.sessionId = createSessionId();
    if (!['local', 'bridge', 'hybrid'].includes(migrated.mode)) migrated.mode = 'hybrid';
    migrated.schemaVersion = 3;
    extension_settings[EXTENSION_KEY] = migrated;
    saveSettingsDebounced();
}

function saveSettings() {
    saveSettingsDebounced();
}

function debug(...args) {
    if (settings()?.debugMode) console.debug('[⚔️ Kesatria v3]', ...args);
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

function truncate(value, max = 100) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatTime(timestamp = Date.now()) {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
}

function log(type, message, details = null) {
    const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        message,
        details,
        timestamp: Date.now(),
    };

    runtime.update(state => ({
        activity: [entry, ...state.activity].slice(0, MAX_ACTIVITY),
    }));

    if (type === 'error') console.error('[Kesatria]', message, details || '');
    else debug(message, details || '');
}

function capabilities() {
    return registry
        ? registry.list({ source: 'remote' }).map(action => action.id)
        : [];
}

function permissionAllowed(permission, { source }) {
    if (source === 'local') return settings().mode !== 'bridge';
    if (!settings().enabled || settings().mode === 'local') return false;
    if (!permission) return true;
    return settings().permissions?.[permission] !== false;
}

function registerActions() {
    registry = new ActionRegistry({
        permissionResolver: permissionAllowed,
        contextProvider: ({ execution }) => ({ signal: execution.signal }),
    });

    const actions = [
        {
            id: 'system.status',
            title: 'System Status',
            description: 'Read the active chat, character, generation, and bridge state.',
            category: 'System',
            icon: '◉',
            permission: 'system.read',
            execute: () => ({
                extension: { name: EXTENSION_NAME, version: VERSION, mode: settings().mode },
                sillyTavern: sillyTavern.getStatus(),
                bridge: runtime.get().bridge,
                queue: {
                    active: Boolean(runtime.get().queue.active),
                    pending: runtime.get().queue.pending.length,
                },
            }),
        },
        {
            id: 'character.info',
            title: 'Character Snapshot',
            description: 'Read the active character, user persona, and current chat metadata.',
            category: 'Character',
            icon: '👤',
            permission: 'character.read',
            execute: () => sillyTavern.getCharacterInfo(),
        },
        {
            id: 'chat.history',
            title: 'Read Chat History',
            description: 'Return a paginated slice of the current SillyTavern chat.',
            category: 'Chat',
            icon: '📖',
            permission: 'chat.read',
            execute: payload => sillyTavern.getChatHistory(payload),
        },
        {
            id: 'chat.last_response',
            title: 'Last AI Response',
            description: 'Read the most recent assistant or character response.',
            category: 'Chat',
            icon: '💬',
            permission: 'chat.read',
            execute: () => ({ message: sillyTavern.lastAssistantMessage() }),
        },
        {
            id: 'chat.send_as_user',
            title: 'Send as User',
            description: 'Send a message directly through the SillyTavern composer and wait for the reply.',
            category: 'Chat',
            icon: '➤',
            permission: 'chat.write',
            risk: 'medium',
            input: { field: 'message', label: 'Message', placeholder: 'Write a message as the user…' },
            execute: (payload, context) => sillyTavern.sendAsUser(
                payload.message || payload.text,
                { waitForReply: payload.waitForReply !== false, signal: context.signal },
            ),
        },
        {
            id: 'generation.quiet',
            title: 'Quiet Generate',
            description: 'Generate text with a custom prompt without posting it into the chat.',
            category: 'Generation',
            icon: '✦',
            permission: 'generation.run',
            input: { field: 'prompt', label: 'Prompt', placeholder: 'Enter a private generation prompt…' },
            execute: payload => sillyTavern.generateQuiet(payload.prompt || payload.message),
        },
        {
            id: 'generation.continue',
            title: 'Continue Response',
            description: 'Trigger SillyTavern’s native continue-generation control.',
            category: 'Generation',
            icon: '⏩',
            permission: 'generation.run',
            execute: () => sillyTavern.continueGeneration(),
        },
        {
            id: 'generation.regenerate',
            title: 'Regenerate Response',
            description: 'Trigger SillyTavern’s native regenerate control.',
            category: 'Generation',
            icon: '↻',
            permission: 'generation.run',
            risk: 'medium',
            execute: () => sillyTavern.regenerate(),
        },
        {
            id: 'generation.stop',
            title: 'Stop Generation',
            description: 'Stop an active SillyTavern generation.',
            category: 'Generation',
            icon: '■',
            permission: 'generation.stop',
            execute: () => sillyTavern.stopGeneration(),
        },
        {
            id: 'chat.save',
            title: 'Save Current Chat',
            description: 'Force SillyTavern to persist the current chat.',
            category: 'System',
            icon: '💾',
            permission: 'system.save',
            execute: () => sillyTavern.save(),
        },
        {
            id: 'chat.reload',
            title: 'Reload Current Chat',
            description: 'Reload the active conversation from SillyTavern storage.',
            category: 'System',
            icon: '⟳',
            permission: 'system.save',
            risk: 'medium',
            sources: ['local'],
            execute: () => sillyTavern.reload(),
        },
    ];

    actions.forEach(action => registry.register(action));
}

function createQueue() {
    queue = new ActionQueue(registry, { maxHistory: 100, defaultTimeout: 120000 });
    queue.subscribe(snapshot => {
        runtime.update({ queue: snapshot });
        renderQueue(snapshot);
        renderOverview();
    });
}

const legacyActionMap = {
    send_message: 'chat.send_as_user',
    get_chat_history: 'chat.history',
    get_character_info: 'character.info',
    get_chat_list: 'system.status',
    get_last_response: 'chat.last_response',
    generate: 'generation.quiet',
    continue: 'generation.continue',
    regenerate: 'generation.regenerate',
    stop_generation: 'generation.stop',
    save_chat: 'chat.save',
    get_status: 'system.status',
};

function pruneProcessedRequests() {
    const cutoff = Date.now() - (10 * 60 * 1000);
    for (const [id, timestamp] of processedRemoteRequests.entries()) {
        if (timestamp < cutoff) processedRemoteRequests.delete(id);
    }
}

async function handleRemoteRequest(request) {
    const requestId = request.request_id || request.id || `remote-${Date.now()}`;
    pruneProcessedRequests();

    if (processedRemoteRequests.has(requestId)) {
        log('warning', `Duplicate remote request ignored: ${requestId}`);
        return;
    }
    processedRemoteRequests.set(requestId, Date.now());

    const actionId = legacyActionMap[request.action] || request.action;
    log('remote', `Remote request: ${actionId}`, { requestId });

    try {
        const result = await queue.enqueue({
            actionId,
            payload: request.payload || {},
            source: 'remote',
            requestId,
            timeoutMs: request.timeout_ms,
        });

        await bridge.sendResponse({
            type: 'action_response',
            protocol: 'kesatria/3',
            request_id: requestId,
            session_id: settings().sessionId,
            action: actionId,
            status: 'success',
            data: result,
        });
        log('success', `Remote action completed: ${actionId}`);
    } catch (error) {
        try {
            await bridge.sendResponse({
                type: 'action_response',
                protocol: 'kesatria/3',
                request_id: requestId,
                session_id: settings().sessionId,
                action: actionId,
                status: 'error',
                message: error.message,
                data: null,
            });
        } catch (responseError) {
            log('error', `Could not return remote error: ${responseError.message}`);
        }
        log('error', `Remote action failed: ${actionId}`, error.message);
    }
}

function createBridge() {
    bridge = new BridgeClient({
        getSettings: () => ({ ...settings(), capabilities: capabilities() }),
        onRequest: handleRemoteRequest,
        onState: bridgeState => {
            runtime.update({ bridge: bridgeState });
            renderBridgeState(bridgeState);
            renderOverview();
        },
        logger: (type, message) => log(type, message),
    });
}

async function loadInterface() {
    if (document.getElementById('kesatria-v3-root')) return;
    const html = await $.get(`${ROOT_PATH}/html/settings.html`);
    document.body.insertAdjacentHTML('beforeend', html);

    const settingsContainer = document.getElementById('extensions_settings');
    if (settingsContainer && !document.getElementById('kesatria-extension-entry')) {
        settingsContainer.insertAdjacentHTML('beforeend', `
            <div id="kesatria-extension-entry" class="kesatria-extension-entry">
                <div>
                    <strong>⚔️ Kesatria Command Center</strong>
                    <small>v${VERSION} · Local-first SillyTavern control</small>
                </div>
                <button type="button" class="menu_button" data-kesatria-open>Open</button>
            </div>
        `);
    }
}

function setTab(tabName) {
    runtime.update({ activeTab: tabName });
    document.querySelectorAll('[data-kesatria-tab]').forEach(button => {
        button.classList.toggle('is-active', button.dataset.kesatriaTab === tabName);
    });
    document.querySelectorAll('[data-kesatria-page]').forEach(page => {
        page.classList.toggle('is-active', page.dataset.kesatriaPage === tabName);
    });
}

function openApp() {
    const overlay = document.getElementById('kesatria-modal-overlay');
    if (!overlay) return;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('kesatria-modal-open');
    refreshContextDisplay();
    renderOverview();
}

function closeApp() {
    const overlay = document.getElementById('kesatria-modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('kesatria-modal-open');
}

function actionResultLabel(result) {
    if (result?.reply?.content) return truncate(result.reply.content, 120);
    if (result?.response) return truncate(result.response, 120);
    if (result?.messages) return `${result.messages.length} messages returned`;
    return 'Action completed';
}

async function runLocalAction(actionId, payload = {}) {
    const action = registry.get(actionId);
    if (!action) return;

    log('local', `Local action queued: ${action.title}`);
    try {
        const result = await queue.enqueue({ actionId, payload, source: 'local' });
        log('success', `${action.title}: ${actionResultLabel(result)}`, result);
        showResult(action.title, result);
    } catch (error) {
        log('error', `${action.title} failed: ${error.message}`);
        showToast(error.message, 'error');
    }
}

function openCommandDialog(action) {
    pendingDialogAction = action;
    const dialog = document.getElementById('kesatria-command-dialog');
    const title = document.getElementById('kesatria-dialog-title');
    const label = document.getElementById('kesatria-dialog-label');
    const input = document.getElementById('kesatria-dialog-input');
    if (!dialog || !input) return;

    title.textContent = action.title;
    label.textContent = action.input.label;
    input.placeholder = action.input.placeholder || '';
    input.value = '';
    dialog.classList.add('is-open');
    setTimeout(() => input.focus(), 50);
}

function closeCommandDialog() {
    document.getElementById('kesatria-command-dialog')?.classList.remove('is-open');
    pendingDialogAction = null;
}

function showResult(title, result) {
    const panel = document.getElementById('kesatria-result-panel');
    const titleNode = document.getElementById('kesatria-result-title');
    const content = document.getElementById('kesatria-result-content');
    if (!panel || !content) return;
    titleNode.textContent = title;
    content.textContent = JSON.stringify(result, null, 2);
    panel.classList.add('is-open');
}

function closeResult() {
    document.getElementById('kesatria-result-panel')?.classList.remove('is-open');
}

function showToast(message, type = 'info') {
    const host = document.getElementById('kesatria-toast-host');
    if (!host) return;
    const toast = document.createElement('div');
    toast.className = `kesatria-toast is-${type}`;
    toast.textContent = message;
    host.append(toast);
    setTimeout(() => toast.classList.add('is-visible'), 10);
    setTimeout(() => {
        toast.classList.remove('is-visible');
        setTimeout(() => toast.remove(), 250);
    }, 3500);
}

function renderActions(filter = '') {
    const container = document.getElementById('kesatria-command-list');
    if (!container) return;

    const normalizedFilter = filter.trim().toLowerCase();
    const actions = registry.list({ source: 'local' }).filter(action => {
        const haystack = `${action.title} ${action.description} ${action.id} ${action.category}`.toLowerCase();
        return !normalizedFilter || haystack.includes(normalizedFilter);
    });

    container.innerHTML = actions.map(action => `
        <button type="button" class="kesatria-command-card" data-kesatria-action="${escapeHtml(action.id)}">
            <span class="kesatria-command-icon">${action.icon}</span>
            <span class="kesatria-command-copy">
                <strong>${escapeHtml(action.title)}</strong>
                <small>${escapeHtml(action.description)}</small>
                <code>${escapeHtml(action.id)}</code>
            </span>
            <span class="kesatria-command-arrow">›</span>
        </button>
    `).join('') || '<div class="kesatria-empty">No matching commands.</div>';
}

function renderQueue(snapshot = runtime.get().queue) {
    const container = document.getElementById('kesatria-queue-list');
    if (!container) return;

    const rows = [];
    if (snapshot.active) rows.push(snapshot.active);
    rows.push(...snapshot.pending);
    rows.push(...snapshot.history.slice(0, 30));

    container.innerHTML = rows.map(item => {
        const duration = item.startedAt && item.finishedAt ? `${((item.finishedAt - item.startedAt) / 1000).toFixed(1)}s` : '';
        const cancellable = ['queued', 'running'].includes(item.status);
        return `
            <div class="kesatria-queue-row is-${escapeHtml(item.status)}">
                <div class="kesatria-queue-state"><span></span>${escapeHtml(item.status)}</div>
                <div class="kesatria-queue-main">
                    <strong>${escapeHtml(item.actionTitle || item.actionId)}</strong>
                    <small>${escapeHtml(item.source)} · ${formatTime(item.createdAt)} ${duration ? `· ${duration}` : ''}</small>
                    ${item.error ? `<em>${escapeHtml(item.error)}</em>` : ''}
                </div>
                ${cancellable ? `<button type="button" class="kesatria-icon-button" data-kesatria-cancel="${escapeHtml(item.id)}" title="Cancel">✕</button>` : ''}
            </div>
        `;
    }).join('') || '<div class="kesatria-empty">The action queue is empty.</div>';
}

function renderActivity(activity = runtime.get().activity) {
    const container = document.getElementById('kesatria-activity-list');
    if (!container) return;
    container.innerHTML = activity.map(entry => `
        <div class="kesatria-activity-row is-${escapeHtml(entry.type)}">
            <span class="kesatria-activity-time">${formatTime(entry.timestamp)}</span>
            <span class="kesatria-activity-dot"></span>
            <span>${escapeHtml(entry.message)}</span>
        </div>
    `).join('') || '<div class="kesatria-empty">No activity yet.</div>';
}

function bridgeStatusLabel(status) {
    return ({
        offline: 'Offline',
        connecting: 'Connecting',
        connected: 'Connected',
        error: 'Connection Error',
    })[status] || status;
}

function renderBridgeState(bridgeState = runtime.get().bridge) {
    const statusNodes = document.querySelectorAll('[data-kesatria-bridge-status]');
    statusNodes.forEach(node => {
        node.textContent = bridgeStatusLabel(bridgeState.status);
        node.dataset.status = bridgeState.status;
    });

    document.querySelectorAll('[data-kesatria-latency]').forEach(node => {
        node.textContent = bridgeState.latency == null ? '-- ms' : `${bridgeState.latency} ms`;
    });

    const button = document.getElementById('kesatria-bridge-toggle');
    if (button) {
        button.textContent = settings().enabled ? 'Disconnect Bridge' : 'Connect Bridge';
        button.classList.toggle('is-danger', settings().enabled);
    }
}

function renderOverview() {
    const state = runtime.get();
    const context = sillyTavern?.getStatus?.() || {};
    const values = {
        'overview-mode': settings()?.mode || 'hybrid',
        'overview-character': context.character || 'No character',
        'overview-messages': String(context.messageCount ?? 0),
        'overview-queue': String((state.queue.pending?.length || 0) + (state.queue.active ? 1 : 0)),
        'overview-bridge': bridgeStatusLabel(state.bridge.status),
        'overview-latency': state.bridge.latency == null ? '-- ms' : `${state.bridge.latency} ms`,
    };

    Object.entries(values).forEach(([id, value]) => {
        const node = document.getElementById(`kesatria-${id}`);
        if (node) node.textContent = value;
    });
}

function refreshContextDisplay() {
    try {
        const info = sillyTavern.getCharacterInfo();
        const name = document.getElementById('kesatria-active-character');
        const meta = document.getElementById('kesatria-active-meta');
        const avatar = document.getElementById('kesatria-active-avatar');
        if (name) name.textContent = info.character.name;
        if (meta) meta.textContent = `${info.user.name} ↔ ${info.character.name} · ${info.chat.messageCount} messages`;
        if (avatar) {
            if (info.character.avatar) {
                avatar.innerHTML = `<img src="/characters/${encodeURIComponent(info.character.avatar)}" alt="">`;
            } else {
                avatar.textContent = '👤';
            }
        }
    } catch (error) {
        debug('Context display failed', error);
    }
}

function syncSettingsUI() {
    const current = settings();
    const fields = {
        'kesatria-bridge-url': current.bridgeUrl,
        'kesatria-auth-token': current.authToken,
        'kesatria-session-id': current.sessionId,
        'kesatria-polling-interval': current.pollingInterval,
        'kesatria-mode': current.mode,
    };

    Object.entries(fields).forEach(([id, value]) => {
        const node = document.getElementById(id);
        if (node) node.value = value ?? '';
    });

    const checks = {
        'kesatria-auto-connect': current.autoConnect,
        'kesatria-debug-mode': current.debugMode,
        'kesatria-reduced-motion': current.reducedMotion,
    };
    Object.entries(checks).forEach(([id, checked]) => {
        const node = document.getElementById(id);
        if (node) node.checked = Boolean(checked);
    });

    document.querySelectorAll('[data-kesatria-permission]').forEach(input => {
        input.checked = current.permissions?.[input.dataset.kesatriaPermission] !== false;
    });

    document.documentElement.classList.toggle('kesatria-reduce-motion', Boolean(current.reducedMotion));
}

async function toggleBridge() {
    if (settings().enabled) {
        settings().enabled = false;
        bridge.stop();
        saveSettings();
        log('info', 'Bridge disconnected by user');
        renderBridgeState();
        return;
    }

    if (settings().mode === 'local') {
        showToast('Change mode to Hybrid or Bridge before connecting.', 'error');
        return;
    }

    settings().enabled = true;
    saveSettings();
    try {
        await bridge.start();
        log('info', 'Bridge connection started');
    } catch (error) {
        settings().enabled = false;
        saveSettings();
        bridge.stop();
        log('error', `Bridge start failed: ${error.message}`);
        showToast(error.message, 'error');
    }
    renderBridgeState();
}

async function testBridge() {
    const button = document.getElementById('kesatria-test-bridge');
    if (button) button.disabled = true;
    try {
        const result = await bridge.test();
        log('success', `Bridge health check passed (${result.latency}ms)`, result);
        showToast(`Bridge reachable in ${result.latency}ms`, 'success');
        showResult('Bridge Health', result);
    } catch (error) {
        log('error', `Bridge health check failed: ${error.message}`);
        showToast(error.message, 'error');
    } finally {
        if (button) button.disabled = false;
    }
}

function saveFormSettings() {
    const current = settings();
    current.bridgeUrl = document.getElementById('kesatria-bridge-url')?.value?.trim() || '';
    current.authToken = document.getElementById('kesatria-auth-token')?.value || '';
    current.sessionId = document.getElementById('kesatria-session-id')?.value?.trim() || createSessionId();
    current.pollingInterval = Math.min(30000, Math.max(750, Number(document.getElementById('kesatria-polling-interval')?.value) || 2000));
    current.mode = document.getElementById('kesatria-mode')?.value || 'hybrid';
    current.autoConnect = Boolean(document.getElementById('kesatria-auto-connect')?.checked);
    current.debugMode = Boolean(document.getElementById('kesatria-debug-mode')?.checked);
    current.reducedMotion = Boolean(document.getElementById('kesatria-reduced-motion')?.checked);

    document.querySelectorAll('[data-kesatria-permission]').forEach(input => {
        current.permissions[input.dataset.kesatriaPermission] = input.checked;
    });

    saveSettings();
    document.documentElement.classList.toggle('kesatria-reduce-motion', current.reducedMotion);
    renderOverview();
    showToast('Settings saved', 'success');
    log('info', 'Settings updated');

    if (current.enabled) {
        bridge.stop({ silent: true });
        void bridge.start();
    }
}

function resetSession() {
    settings().sessionId = createSessionId();
    const input = document.getElementById('kesatria-session-id');
    if (input) input.value = settings().sessionId;
    saveSettings();
    showToast('New session ID generated', 'success');
}

function setupLauncherDrag() {
    const launcher = document.getElementById('kesatria-launcher');
    if (!launcher) return;

    const saved = settings().launcherPosition;
    if (saved?.top != null && saved?.side) {
        launcher.style.top = `${Math.max(12, Math.min(window.innerHeight - 72, saved.top))}px`;
        launcher.style.bottom = 'auto';
        launcher.style[saved.side] = '18px';
        launcher.style[saved.side === 'left' ? 'right' : 'left'] = 'auto';
    }

    let start = null;
    let moved = false;

    launcher.addEventListener('pointerdown', event => {
        start = { x: event.clientX, y: event.clientY, rect: launcher.getBoundingClientRect() };
        moved = false;
        launcher.setPointerCapture(event.pointerId);
    });

    launcher.addEventListener('pointermove', event => {
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        if (!moved) return;

        const left = Math.max(8, Math.min(window.innerWidth - launcher.offsetWidth - 8, start.rect.left + dx));
        const top = Math.max(8, Math.min(window.innerHeight - launcher.offsetHeight - 8, start.rect.top + dy));
        launcher.style.left = `${left}px`;
        launcher.style.right = 'auto';
        launcher.style.top = `${top}px`;
        launcher.style.bottom = 'auto';
    });

    launcher.addEventListener('pointerup', event => {
        if (!start) return;
        launcher.releasePointerCapture(event.pointerId);
        const rect = launcher.getBoundingClientRect();
        const side = rect.left + rect.width / 2 < window.innerWidth / 2 ? 'left' : 'right';
        launcher.style[side] = '18px';
        launcher.style[side === 'left' ? 'right' : 'left'] = 'auto';
        settings().launcherPosition = { side, top: Math.round(rect.top) };
        saveSettings();
        start = null;
        if (!moved) openApp();
    });
}

function setupUiEvents() {
    document.addEventListener('click', event => {
        const openButton = event.target.closest('[data-kesatria-open]');
        if (openButton) {
            event.preventDefault();
            openApp();
            return;
        }

        if (event.target.closest('[data-kesatria-close]')) {
            event.preventDefault();
            closeApp();
            return;
        }

        const tab = event.target.closest('[data-kesatria-tab]');
        if (tab) {
            setTab(tab.dataset.kesatriaTab);
            return;
        }

        const actionButton = event.target.closest('[data-kesatria-action]');
        if (actionButton) {
            const action = registry.get(actionButton.dataset.kesatriaAction);
            if (action?.input) openCommandDialog(action);
            else void runLocalAction(action.id);
            return;
        }

        const cancelButton = event.target.closest('[data-kesatria-cancel]');
        if (cancelButton) queue.cancel(cancelButton.dataset.kesatriaCancel);
    });

    document.getElementById('kesatria-close-dialog')?.addEventListener('click', closeCommandDialog);
    document.getElementById('kesatria-dialog-cancel')?.addEventListener('click', closeCommandDialog);
    document.getElementById('kesatria-dialog-run')?.addEventListener('click', () => {
        if (!pendingDialogAction) return;
        const value = document.getElementById('kesatria-dialog-input')?.value?.trim();
        if (!value) {
            showToast(`${pendingDialogAction.input.label} cannot be empty`, 'error');
            return;
        }
        const action = pendingDialogAction;
        closeCommandDialog();
        void runLocalAction(action.id, { [action.input.field]: value });
    });

    document.getElementById('kesatria-close-result')?.addEventListener('click', closeResult);
    document.getElementById('kesatria-result-copy')?.addEventListener('click', async () => {
        const text = document.getElementById('kesatria-result-content')?.textContent || '';
        await navigator.clipboard.writeText(text);
        showToast('Result copied', 'success');
    });

    document.getElementById('kesatria-command-search')?.addEventListener('input', event => renderActions(event.target.value));
    document.getElementById('kesatria-bridge-toggle')?.addEventListener('click', () => void toggleBridge());
    document.getElementById('kesatria-test-bridge')?.addEventListener('click', () => void testBridge());
    document.getElementById('kesatria-save-settings')?.addEventListener('click', saveFormSettings);
    document.getElementById('kesatria-save-policy')?.addEventListener('click', saveFormSettings);
    document.getElementById('kesatria-reset-session')?.addEventListener('click', resetSession);
    document.getElementById('kesatria-clear-queue')?.addEventListener('click', () => queue.clearCompleted());
    document.getElementById('kesatria-clear-activity')?.addEventListener('click', () => {
        runtime.update({ activity: [] });
        renderActivity([]);
    });

    document.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            openApp();
            setTab('commands');
            setTimeout(() => document.getElementById('kesatria-command-search')?.focus(), 50);
        }
        if (event.key === 'Escape') {
            closeCommandDialog();
            closeResult();
        }
    });

    setupLauncherDrag();
}

function bindSillyTavernEvents() {
    const bind = (type, handler) => {
        if (type && eventSource?.on) eventSource.on(type, handler);
    };

    bind(event_types?.APP_READY, () => {
        refreshContextDisplay();
        renderOverview();
    });
    bind(event_types?.CHAT_CHANGED, () => {
        refreshContextDisplay();
        renderOverview();
        log('info', 'Active chat changed');
    });
    bind(event_types?.MESSAGE_RECEIVED, () => {
        renderOverview();
        log('info', 'SillyTavern received a new message');
    });
    bind(event_types?.GENERATION_STARTED, () => renderOverview());
    bind(event_types?.GENERATION_ENDED, () => renderOverview());
}

async function initialize() {
    migrateSettings();
    sillyTavern = new SillyTavernAdapter({
        getContext,
        generateQuietPrompt,
        saveChat,
        reloadCurrentChat,
    });

    registerActions();
    createQueue();
    createBridge();

    try {
        await loadInterface();
    } catch (error) {
        console.error('[Kesatria] UI load failed', error);
        return;
    }

    syncSettingsUI();
    setupUiEvents();
    bindSillyTavernEvents();
    renderActions();
    renderQueue();
    renderActivity();
    renderBridgeState();
    refreshContextDisplay();
    renderOverview();

    log('success', `Kesatria Command Center v${VERSION} loaded`);

    if (settings().autoConnect && settings().enabled && settings().mode !== 'local') {
        try {
            await bridge.start();
        } catch (error) {
            settings().enabled = false;
            saveSettings();
            log('error', `Auto-connect failed: ${error.message}`);
        }
    }

    console.log(`[⚔️ Kesatria] v${VERSION} loaded — local-first command center ready`);
}

jQuery(() => void initialize());
