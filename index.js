/**
 * ⚔️ Kesatria Penghubung Baja Hitam v2.1
 * SillyTavern Extension - Warrior Command Center
 */

import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    getRequestHeaders,
    generateQuietPrompt,
    substituteParams,
    saveChat,
    reloadCurrentChat,
    addOneMessage,
} from '../../../../script.js';

import {
    extension_settings,
    getContext,
} from '../../../extensions.js';

// ─── Settings ───────────────────────────────────
const defaultSettings = {
    enabled: false,
    bridgeUrl: '',
    sessionId: `session-${Math.random().toString(36).substring(2, 15)}`,
    autoConnect: false,
    pollingInterval: 2000,
    debugMode: false,
};

// ─── State ──────────────────────────────────────
let bridgeState = {
    status: 'disconnected',
    lastMessage: '',
    pollingTimer: null,
    isProcessing: false,
    connectedAt: null,
    stats: { sent: 0, received: 0, errors: 0 },
    logEntries: [],
    logFilter: 'all',
    logPaused: false,
    uptimeTimer: null,
    processStartTime: null,
    processTimer: null,
    pollCount: 0,
    latency: null,
    lastPollTime: null,
};

const MAX_LOG_ENTRIES = 200;

// ─── Settings ───────────────────────────────────
function loadSettings() {
    if (!extension_settings.kesatria) {
        extension_settings.kesatria = { ...defaultSettings };
    }
    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings.kesatria[key] === undefined) {
            extension_settings.kesatria[key] = defaultSettings[key];
        }
    }
}

function saveSettings() {
    saveSettingsDebounced();
}

function debugLog(...args) {
    if (extension_settings.kesatria?.debugMode) {
        console.log('[⚔️ Kesatria]', ...args);
    }
}

// ─── Tabs ───────────────────────────────────────
function setupTabs() {
    document.querySelectorAll('.kesatria-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            
            // Update active tab
            document.querySelectorAll('.kesatria-tab').forEach(t => t.classList.remove('kesa-tab-active'));
            tab.classList.add('kesa-tab-active');
            
            // Show content
            document.querySelectorAll('.kesatria-tab-content').forEach(c => c.classList.remove('kesa-tab-show'));
            document.getElementById(`kesa-tab-${tabName}`)?.classList.add('kesa-tab-show');
        });
    });
}

// ─── Activity Log ───────────────────────────────
function addLogEntry(type, message) {
    if (bridgeState.logPaused) return;
    
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const icons = { send: '➤', recv: '◀', err: '✖', info: '●', conn: '◉' };
    
    const entry = { type, message, time, icon: icons[type] || '●', timestamp: Date.now() };
    bridgeState.logEntries.unshift(entry);
    
    if (bridgeState.logEntries.length > MAX_LOG_ENTRIES) {
        bridgeState.logEntries = bridgeState.logEntries.slice(0, MAX_LOG_ENTRIES);
    }
    
    renderLogEntries();
    updateLogBadge();
}

function renderLogEntries() {
    const container = document.getElementById('kesatria-log-entries');
    if (!container) return;
    
    let entries = bridgeState.logEntries;
    if (bridgeState.logFilter !== 'all') {
        entries = entries.filter(e => e.type === bridgeState.logFilter);
    }
    
    if (entries.length === 0) {
        container.innerHTML = `
            <div class="kesatria-log-empty">
                <div class="kesatria-log-empty-icon">📜</div>
                <div class="kesatria-log-empty-text">No ${bridgeState.logFilter === 'all' ? '' : bridgeState.logFilter + ' '}activity yet</div>
            </div>`;
    } else {
        container.innerHTML = entries.map(entry => `
            <div class="kesatria-log-entry kesatria-log-${entry.type}">
                <span class="kesatria-log-time">${entry.time}</span>
                <span class="kesatria-log-icon">${entry.icon}</span>
                <span class="kesatria-log-msg">${escapeHtml(entry.message)}</span>
            </div>
        `).join('');
    }
}

function updateLogBadge() {
    const badge = document.getElementById('kesatria-log-badge');
    if (badge) badge.textContent = bridgeState.logEntries.length;
}

function clearLog() {
    bridgeState.logEntries = [];
    renderLogEntries();
    updateLogBadge();
}

function setupLogFilters() {
    document.querySelectorAll('.kesatria-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.kesatria-filter-btn').forEach(b => b.classList.remove('kesa-filter-active'));
            btn.classList.add('kesa-filter-active');
            bridgeState.logFilter = btn.dataset.filter;
            renderLogEntries();
        });
    });
    
    document.getElementById('kesatria-log-pause')?.addEventListener('click', () => {
        bridgeState.logPaused = !bridgeState.logPaused;
        const btn = document.getElementById('kesatria-log-pause');
        if (btn) btn.textContent = bridgeState.logPaused ? '▶' : '⏸';
    });
    
    document.getElementById('kesatria-log-clear')?.addEventListener('click', clearLog);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ─── Stats ──────────────────────────────────────
function updateStats() {
    const sent = document.getElementById('kesatria-stat-sent');
    const recv = document.getElementById('kesatria-stat-received');
    const errs = document.getElementById('kesatria-stat-errors');
    const uptime = document.getElementById('kesatria-stat-uptime');
    const polls = document.getElementById('kesatria-poll-count');
    
    if (sent) sent.textContent = bridgeState.stats.sent;
    if (recv) recv.textContent = bridgeState.stats.received;
    if (errs) errs.textContent = bridgeState.stats.errors;
    if (polls) polls.textContent = `${bridgeState.pollCount} polls`;
    
    if (uptime) {
        if (bridgeState.connectedAt) {
            const diff = Date.now() - bridgeState.connectedAt;
            const mins = Math.floor(diff / 60000);
            const hrs = Math.floor(mins / 60);
            uptime.textContent = hrs > 0 ? `${hrs}h${mins % 60}m` : `${mins}m`;
        } else {
            uptime.textContent = '--';
        }
    }
}

function startUptimeTimer() {
    if (bridgeState.uptimeTimer) clearInterval(bridgeState.uptimeTimer);
    bridgeState.uptimeTimer = setInterval(updateStats, 10000);
}

function stopUptimeTimer() {
    if (bridgeState.uptimeTimer) {
        clearInterval(bridgeState.uptimeTimer);
        bridgeState.uptimeTimer = null;
    }
}

// ─── Status UI ──────────────────────────────────
function updateStatusUI() {
    const dot = document.getElementById('kesatria-status-dot');
    const label = document.getElementById('kesatria-status-text');
    const detail = document.getElementById('kesatria-status-detail');
    const ringFill = document.getElementById('kesatria-ring-fill');
    const latency = document.getElementById('kesatria-latency-value');
    const healthText = document.getElementById('kesatria-health-text');
    const healthFill = document.querySelector('.kesatria-health-fill');
    
    const statusMap = {
        disconnected: { class: 'kesatria-dot-off', label: 'OFFLINE', detail: '', ring: 0, color: '#555', health: 'OFF', healthColor: '#555' },
        connected: { class: 'kesatria-dot-connected', label: 'CONNECTED', detail: 'Bridge active', ring: 100, color: '#4CAF50', health: 'STABLE', healthColor: '#4CAF50' },
        processing: { class: 'kesatria-dot-processing', label: 'PROCESSING', detail: bridgeState.lastMessage, ring: 60, color: '#FFC107', health: 'BUSY', healthColor: '#FFC107' },
        error: { class: 'kesatria-dot-error', label: 'ERROR', detail: bridgeState.lastMessage, ring: 25, color: '#F44336', health: 'ERROR', healthColor: '#F44336' },
    };
    
    const s = statusMap[bridgeState.status] || statusMap.disconnected;
    
    if (dot) dot.className = `kesatria-dot ${s.class}`;
    if (label) label.textContent = s.label;
    if (label) label.style.color = s.color;
    if (detail) { detail.textContent = s.detail; detail.style.display = s.detail ? 'block' : 'none'; }
    if (ringFill) { ringFill.style.strokeDashoffset = 100 - s.ring; ringFill.style.stroke = s.color; }
    if (latency) latency.textContent = bridgeState.latency ? `${bridgeState.latency}ms` : '--ms';
    if (healthText) { healthText.textContent = s.health; healthText.style.color = s.healthColor; }
    if (healthFill) healthFill.style.background = `linear-gradient(90deg, ${s.healthColor}, ${s.healthColor}88)`;
}

// ─── Processing Bar ─────────────────────────────
function showProcessing(text) {
    const bar = document.getElementById('kesatria-processing');
    const textEl = document.getElementById('kesatria-processing-text');
    const fill = document.getElementById('kesatria-progress-bar');
    const timeEl = document.getElementById('kesatria-processing-time');
    const steps = document.querySelectorAll('.kesatria-step');
    
    if (bar) bar.style.display = 'block';
    if (textEl) textEl.textContent = text || 'Processing...';
    
    // Reset steps
    steps.forEach((step, i) => {
        step.className = `kesatria-step${i === 0 ? ' kesa-step-done' : ''}`;
        const icon = step.querySelector('.kesa-step-icon');
        if (icon) icon.textContent = i === 0 ? '✓' : '◌';
    });
    
    // Animate progress
    if (fill) {
        fill.style.width = '0%';
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 12;
            if (progress > 90) progress = 90;
            fill.style.width = `${progress}%`;
            
            // Update steps
            if (progress > 30 && steps[1]) {
                steps[1].className = 'kesatria-step kesa-step-active';
                steps[1].querySelector('.kesa-step-icon').textContent = '◉';
            }
            if (progress > 60 && steps[2]) {
                steps[2].className = 'kesatria-step kesa-step-active';
                steps[2].querySelector('.kesa-step-icon').textContent = '◉';
            }
        }, 400);
        bar._progressInterval = interval;
    }
    
    // Timer
    bridgeState.processStartTime = Date.now();
    if (bridgeState.processTimer) clearInterval(bridgeState.processTimer);
    bridgeState.processTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - bridgeState.processStartTime) / 1000);
        if (timeEl) timeEl.textContent = `${elapsed}s`;
    }, 1000);
}

function hideProcessing() {
    const bar = document.getElementById('kesatria-processing');
    const fill = document.getElementById('kesatria-progress-bar');
    const steps = document.querySelectorAll('.kesatria-step');
    
    if (bar && bar._progressInterval) clearInterval(bar._progressInterval);
    if (bridgeState.processTimer) clearInterval(bridgeState.processTimer);
    
    // Complete all steps
    steps.forEach(step => {
        step.className = 'kesatria-step kesa-step-done';
        const icon = step.querySelector('.kesa-step-icon');
        if (icon) icon.textContent = '✓';
    });
    
    if (fill) fill.style.width = '100%';
    
    setTimeout(() => {
        if (bar) bar.style.display = 'none';
        if (fill) fill.style.width = '0%';
    }, 800);
}

// ─── Latency ────────────────────────────────────
function measureLatency() {
    if (!bridgeState.lastPollTime) return;
    bridgeState.latency = Date.now() - bridgeState.lastPollTime;
    const el = document.getElementById('kesatria-latency-value');
    if (el) el.textContent = `${bridgeState.latency}ms`;
}

// ─── Bridge Connection ──────────────────────────
async function registerSession() {
    const settings = extension_settings.kesatria;
    if (!settings?.bridgeUrl) return;
    
    try {
        const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
        const response = await fetch(`${cleanUrl}/register?session=${settings.sessionId}`, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'ngrok-skip-browser-warning': 'true', 'Bypass-Tunnel-Reminder': 'true' },
        });
        if (response.ok) debugLog('Session registered');
    } catch (error) {
        debugLog('Registration error:', error.message);
    }
}

async function pollBridge() {
    const settings = extension_settings.kesatria;
    if (!settings?.enabled || !settings?.bridgeUrl || bridgeState.isProcessing) return;
    
    bridgeState.lastPollTime = Date.now();
    bridgeState.pollCount++;
    
    try {
        const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
        const response = await fetch(`${cleanUrl}/poll?session_id=${settings.sessionId}`, {
            headers: { 'Accept': 'application/json', 'ngrok-skip-browser-warning': 'true', 'Bypass-Tunnel-Reminder': 'true' },
        });
        
        measureLatency();
        
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) throw new Error('Expected JSON');
        
        const data = await response.json();
        
        if (bridgeState.status !== 'connected') {
            bridgeState.status = 'connected';
            bridgeState.connectedAt = Date.now();
            updateStatusUI();
            updateStats();
            addLogEntry('conn', 'Bridge connected');
        }
        
        if (data.has_pending_request && data.request) {
            await handleBridgeRequest(data.request);
        }
        
    } catch (error) {
        debugLog('Polling failed:', error.message);
        if (bridgeState.status !== 'error') {
            bridgeState.status = 'error';
            bridgeState.lastMessage = error.message;
            bridgeState.stats.errors++;
            updateStatusUI();
            updateStats();
            addLogEntry('err', `Poll error: ${error.message}`);
        }
    }
}

// ─── Request Handler ────────────────────────────
async function handleBridgeRequest(request) {
    bridgeState.isProcessing = true;
    bridgeState.status = 'processing';
    bridgeState.lastMessage = `Processing: ${request.action || 'task'}`;
    updateStatusUI();
    
    const actionLabel = request.action || 'unknown';
    addLogEntry('recv', `Request: ${actionLabel}`);
    showProcessing(`Processing ${actionLabel}...`);
    
    try {
        let result;
        switch (request.action) {
            case 'send_message': result = await handleSendMessage(request); break;
            case 'get_chat_history': result = await handleGetChatHistory(request); break;
            case 'get_character_info': result = await handleGetCharacterInfo(request); break;
            case 'get_chat_list': result = await handleGetChatList(request); break;
            case 'generate': result = await handleGenerate(request); break;
            default: result = await handleGenericRequest(request); break;
        }
        
        await sendBridgeResponse({
            type: 'action_response',
            session_id: extension_settings.kesatria.sessionId,
            status: 'success',
            message: 'Processed successfully',
            data: result,
        });
        
        bridgeState.stats.received++;
        bridgeState.lastMessage = `${actionLabel} completed`;
        addLogEntry('send', `Response: ${actionLabel} ✓`);
    } catch (error) {
        debugLog('Request error:', error);
        await sendBridgeResponse({
            type: 'action_response',
            session_id: extension_settings.kesatria.sessionId,
            status: 'error',
            message: error.message || 'Internal error',
            data: null,
        });
        bridgeState.stats.errors++;
        bridgeState.lastMessage = `Error: ${error.message}`;
        addLogEntry('err', `Failed: ${error.message}`);
    } finally {
        bridgeState.isProcessing = false;
        bridgeState.status = 'connected';
        updateStatusUI();
        updateStats();
        hideProcessing();
    }
}

// ─── Action Handlers ────────────────────────────
async function handleSendMessage(request) {
    const message = request.payload?.message || request.payload?.text;
    if (!message) throw new Error('No message provided');
    
    addLogEntry('info', `Sending: "${message.substring(0, 40)}..."`);
    
    const textarea = document.getElementById('send_textarea');
    const sendButton = document.getElementById('send_but');
    
    if (textarea && sendButton) {
        textarea.value = message;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        sendButton.click();
        await waitForGeneration();
        bridgeState.stats.sent++;
        return { success: true, sent_message: message, ai_response: getLastAIResponse() };
    }
    throw new Error('Could not find send textarea/button');
}

async function handleGetChatHistory(request) {
    const context = getContext();
    const chat = context.chat || [];
    const limit = request.payload?.limit || 50;
    const offset = request.payload?.offset || 0;
    
    const messages = chat.slice(offset, offset + limit).map((msg, i) => ({
        index: offset + i, role: msg.is_user ? 'user' : 'assistant',
        name: msg.name || (msg.is_user ? 'User' : 'Character'),
        content: msg.mes || '', timestamp: msg.send_date || null, is_system: msg.is_system || false,
    }));
    
    addLogEntry('info', `History: ${messages.length} msgs from ${context.name2 || 'Unknown'}`);
    return { total_messages: chat.length, offset, limit, messages, character: context.name2, persona: context.name1 };
}

async function handleGetCharacterInfo(request) {
    const context = getContext();
    addLogEntry('info', `Character: ${context.name2 || 'Unknown'}`);
    
    return {
        character: {
            name: context.name2 || 'Unknown', description: context.description || '',
            personality: context.personality || '', scenario: context.scenario || '',
            first_mes: context.first_mes || '',
            avatar: context.characters?.[context.characterId]?.avatar || null,
        },
        user: { name: context.name1 || 'User', persona: context.persona || '' },
        chat: { file: context.chatId || null, length: (context.chat || []).length },
    };
}

async function handleGetChatList(request) {
    const context = getContext();
    return { current_chat: context.chatId, character: context.name2, message: 'Use browser for full list' };
}

async function handleGenerate(request) {
    const prompt = request.payload?.prompt || request.payload?.message;
    if (!prompt) throw new Error('No prompt');
    addLogEntry('info', `Generate: "${prompt.substring(0, 40)}..."`);
    const response = await generateQuietPrompt(prompt);
    return { success: true, prompt, response };
}

async function handleGenericRequest(request) {
    const systemPrompt = `[SYSTEM: HERMES BRIDGE]\nAction: ${request.action}\nContext: ${JSON.stringify(request.context || {})}\nPayload: ${JSON.stringify(request.payload || {})}\nRespond appropriately.`;
    const response = await generateQuietPrompt(systemPrompt);
    return { success: true, reply_text: response };
}

// ─── Helpers ────────────────────────────────────
function waitForGeneration() {
    return new Promise((resolve) => {
        const check = () => {
            const context = getContext();
            if (!context.generating) { setTimeout(resolve, 1000); return; }
            setTimeout(check, 500);
        };
        setTimeout(check, 1000);
    });
}

function getLastAIResponse() {
    const chat = getContext().chat || [];
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_user) return { content: chat[i].mes, name: chat[i].name, index: i };
    }
    return null;
}

async function sendBridgeResponse(payload) {
    const settings = extension_settings.kesatria;
    if (!settings?.bridgeUrl) return;
    try {
        await fetch(`${settings.bridgeUrl.replace(/\/$/, '')}/response`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true', 'Bypass-Tunnel-Reminder': 'true' },
            body: JSON.stringify(payload),
        });
    } catch (error) {
        debugLog('Response send failed:', error);
    }
}

// ─── Polling Control ────────────────────────────
function startPolling() {
    const settings = extension_settings.kesatria;
    if (bridgeState.pollingTimer) clearInterval(bridgeState.pollingTimer);
    
    if (settings?.enabled && settings?.bridgeUrl) {
        registerSession();
        bridgeState.pollingTimer = setInterval(pollBridge, settings.pollingInterval || 2000);
        bridgeState.status = 'connected';
        bridgeState.connectedAt = Date.now();
        updateStatusUI();
        updateStats();
        startUptimeTimer();
        addLogEntry('conn', `Polling started: ${settings.bridgeUrl.substring(0, 40)}...`);
    }
}

function stopPolling() {
    if (bridgeState.pollingTimer) { clearInterval(bridgeState.pollingTimer); bridgeState.pollingTimer = null; }
    bridgeState.status = 'disconnected';
    bridgeState.connectedAt = null;
    updateStatusUI();
    updateStats();
    stopUptimeTimer();
    addLogEntry('info', 'Bridge disconnected');
}

function toggleBridge() {
    const settings = extension_settings.kesatria;
    settings.enabled = !settings.enabled;
    settings.enabled ? startPolling() : stopPolling();
    saveSettings();
    updateToggleUI();
}

// ─── UI Updates ─────────────────────────────────
function updateToggleUI() {
    const settings = extension_settings.kesatria;
    const btn = document.getElementById('kesatria-toggle');
    if (btn) {
        if (settings.enabled) {
            btn.className = 'kesatria-btn-main kesatria-btn-disable';
            btn.innerHTML = '<span class="kesatria-btn-ripple"></span><span class="kesatria-btn-icon-inner">⏹</span><span>Disable Bridge</span>';
        } else {
            btn.className = 'kesatria-btn-main kesatria-btn-enable';
            btn.innerHTML = '<span class="kesatria-btn-ripple"></span><span class="kesatria-btn-icon-inner">⚡</span><span>Enable Bridge</span>';
        }
    }
}

function updateFormUI() {
    const settings = extension_settings.kesatria;
    const urlInput = document.getElementById('kesatria-bridge-url');
    if (urlInput) urlInput.value = settings.bridgeUrl || '';
    const sessionInput = document.getElementById('kesatria-session-id');
    if (sessionInput) sessionInput.value = settings.sessionId || '';
    const autoConnect = document.getElementById('kesatria-auto-connect');
    if (autoConnect) autoConnect.checked = settings.autoConnect || false;
    const debug = document.getElementById('kesatria-debug');
    if (debug) debug.checked = settings.debugMode || false;
}

function updateUI() {
    updateToggleUI();
    updateFormUI();
    updateStatusUI();
    updateStats();
    renderLogEntries();
}

// ─── Test Connection ────────────────────────────
async function testConnection() {
    const settings = extension_settings.kesatria;
    const btn = document.getElementById('kesatria-test-btn');
    
    if (!settings?.bridgeUrl) { addLogEntry('err', 'No bridge URL'); return; }
    
    if (btn) { btn.textContent = '⏳ Testing...'; btn.disabled = true; }
    
    try {
        const start = Date.now();
        const response = await fetch(`${settings.bridgeUrl.replace(/\/$/, '')}/health`, {
            headers: { 'Accept': 'application/json', 'ngrok-skip-browser-warning': 'true', 'Bypass-Tunnel-Reminder': 'true' },
        });
        const latency = Date.now() - start;
        
        if (response.ok) {
            const data = await response.json();
            addLogEntry('conn', `Connection OK (${latency}ms) — ${data.sessions || 0} sessions`);
        } else {
            addLogEntry('err', `HTTP ${response.status}`);
        }
    } catch (error) {
        addLogEntry('err', `Failed: ${error.message}`);
    } finally {
        if (btn) { btn.textContent = '⚡ Test'; btn.disabled = false; }
    }
}

// ─── Quick Actions ──────────────────────────────
function setupQuickActions() {
    // Action buttons
    document.querySelectorAll('.kesatria-quick-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            
            if (action === 'send_message') {
                const composer = document.getElementById('kesatria-send-composer');
                if (composer) composer.style.display = composer.style.display === 'none' ? 'block' : 'none';
                document.getElementById('kesatria-generate-composer').style.display = 'none';
                return;
            }
            
            if (action === 'generate') {
                const composer = document.getElementById('kesatria-generate-composer');
                if (composer) composer.style.display = composer.style.display === 'none' ? 'block' : 'none';
                document.getElementById('kesatria-send-composer').style.display = 'none';
                return;
            }
            
            if (!extension_settings.kesatria?.enabled) { addLogEntry('err', 'Bridge not enabled'); return; }
            
            addLogEntry('info', `Quick: ${action}`);
            try {
                await fetch(`${extension_settings.kesatria.bridgeUrl.replace(/\/$/, '')}/submit`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({
                        session_id: extension_settings.kesatria.sessionId,
                        action: action,
                        payload: action === 'get_chat_history' ? { limit: 10 } : {},
                    }),
                });
                addLogEntry('send', `${action} submitted`);
            } catch (error) {
                addLogEntry('err', `Submit failed: ${error.message}`);
            }
        });
    });
    
    // Send message
    document.getElementById('kesatria-send-confirm')?.addEventListener('click', async () => {
        const textArea = document.getElementById('kesatria-send-text');
        const message = textArea?.value?.trim();
        if (!message) { addLogEntry('err', 'Empty message'); return; }
        if (!extension_settings.kesatria?.enabled) { addLogEntry('err', 'Bridge not enabled'); return; }
        
        try {
            await fetch(`${extension_settings.kesatria.bridgeUrl.replace(/\/$/, '')}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ session_id: extension_settings.kesatria.sessionId, action: 'send_message', payload: { message } }),
            });
            addLogEntry('send', `Message sent: "${message.substring(0, 30)}..."`);
            textArea.value = '';
            document.getElementById('kesatria-send-composer').style.display = 'none';
            document.getElementById('kesatria-char-count').textContent = '0';
        } catch (error) {
            addLogEntry('err', `Send failed: ${error.message}`);
        }
    });
    
    // Generate
    document.getElementById('kesatria-generate-confirm')?.addEventListener('click', async () => {
        const textArea = document.getElementById('kesatria-generate-text');
        const prompt = textArea?.value?.trim();
        if (!prompt) { addLogEntry('err', 'Empty prompt'); return; }
        if (!extension_settings.kesatria?.enabled) { addLogEntry('err', 'Bridge not enabled'); return; }
        
        try {
            await fetch(`${extension_settings.kesatria.bridgeUrl.replace(/\/$/, '')}/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ session_id: extension_settings.kesatria.sessionId, action: 'generate', payload: { prompt } }),
            });
            addLogEntry('send', `Generate submitted: "${prompt.substring(0, 30)}..."`);
            textArea.value = '';
            document.getElementById('kesatria-generate-composer').style.display = 'none';
        } catch (error) {
            addLogEntry('err', `Generate failed: ${error.message}`);
        }
    });
    
    // Close buttons
    document.getElementById('kesatria-composer-close')?.addEventListener('click', () => {
        document.getElementById('kesatria-send-composer').style.display = 'none';
    });
    document.getElementById('kesatria-send-cancel')?.addEventListener('click', () => {
        document.getElementById('kesatria-send-composer').style.display = 'none';
    });
    document.getElementById('kesatria-generate-close')?.addEventListener('click', () => {
        document.getElementById('kesatria-generate-composer').style.display = 'none';
    });
    document.getElementById('kesatria-generate-cancel')?.addEventListener('click', () => {
        document.getElementById('kesatria-generate-composer').style.display = 'none';
    });
    
    // Character counters
    document.getElementById('kesatria-send-text')?.addEventListener('input', (e) => {
        document.getElementById('kesatria-char-count').textContent = e.target.value.length;
    });
    document.getElementById('kesatria-generate-text')?.addEventListener('input', (e) => {
        document.getElementById('kesatria-generate-char-count').textContent = e.target.value.length;
    });
}

// ─── Character Tab ──────────────────────────────
function setupCharacterTab() {
    document.getElementById('kesatria-refresh-char')?.addEventListener('click', refreshCharacterInfo);
}

async function refreshCharacterInfo() {
    const panel = document.getElementById('kesatria-char-panel');
    if (!panel) return;
    
    try {
        const context = getContext();
        const name = context.name2 || 'Unknown';
        const avatar = context.characters?.[context.characterId]?.avatar;
        const desc = context.description || 'No description';
        const personality = context.personality || '';
        const scenario = context.scenario || '';
        const msgCount = (context.chat || []).length;
        
        panel.innerHTML = `
            <div class="kesatria-char-card">
                <div class="kesatria-char-avatar">
                    ${avatar ? `<img src="${avatar}" alt="${name}">` : '👤'}
                </div>
                <div class="kesatria-char-info">
                    <div class="kesatria-char-name">${escapeHtml(name)}</div>
                    <div class="kesatria-char-meta">
                        📝 ${msgCount} messages · ${context.name1 || 'User'} ↔ ${name}
                        ${personality ? `<br>🎭 ${escapeHtml(personality.substring(0, 80))}` : ''}
                        ${scenario ? `<br>🌍 ${escapeHtml(scenario.substring(0, 80))}` : ''}
                    </div>
                    <div class="kesatria-char-desc">${escapeHtml(desc.substring(0, 200))}</div>
                </div>
            </div>
        `;
    } catch (error) {
        panel.innerHTML = `
            <div class="kesatria-char-empty">
                <div class="kesatria-char-empty-icon">⚠️</div>
                <div class="kesatria-char-empty-text">Could not load character</div>
                <button id="kesatria-refresh-char" class="kesatria-btn-sm">Retry</button>
            </div>`;
        document.getElementById('kesatria-refresh-char')?.addEventListener('click', refreshCharacterInfo);
    }
}

// ─── Initialize ─────────────────────────────────
jQuery(async () => {
    loadSettings();
    
    const settingsHtml = await renderSettingsPanel();
    const settingsContainer = document.getElementById('extensions_settings');
    if (settingsContainer) settingsContainer.insertAdjacentHTML('beforeend', settingsHtml);
    
    // Setup all components
    setupTabs();
    setupLogFilters();
    setupQuickActions();
    setupCharacterTab();
    
    // Event listeners
    document.getElementById('kesatria-toggle')?.addEventListener('click', toggleBridge);
    
    document.getElementById('kesatria-bridge-url')?.addEventListener('change', (e) => {
        extension_settings.kesatria.bridgeUrl = e.target.value;
        saveSettings();
        if (extension_settings.kesatria.enabled) { stopPolling(); startPolling(); }
    });
    
    document.getElementById('kesatria-session-id')?.addEventListener('change', (e) => {
        extension_settings.kesatria.sessionId = e.target.value;
        saveSettings();
    });
    
    document.getElementById('kesatria-auto-connect')?.addEventListener('change', (e) => {
        extension_settings.kesatria.autoConnect = e.target.checked;
        saveSettings();
    });
    
    document.getElementById('kesatria-debug')?.addEventListener('change', (e) => {
        extension_settings.kesatria.debugMode = e.target.checked;
        saveSettings();
    });
    
    document.getElementById('kesatria-reconnect')?.addEventListener('click', () => {
        if (extension_settings.kesatria.enabled) { stopPolling(); startPolling(); }
    });
    
    document.getElementById('kesatria-test-btn')?.addEventListener('click', testConnection);
    
    document.getElementById('kesatria-copy-session')?.addEventListener('click', () => {
        const input = document.getElementById('kesatria-session-id');
        if (input) {
            navigator.clipboard.writeText(input.value).then(() => {
                addLogEntry('info', 'Session ID copied ✓');
            }).catch(() => {
                input.select();
                document.execCommand('copy');
                addLogEntry('info', 'Session ID copied ✓');
            });
        }
    });
    
    // Auto-connect
    if (extension_settings.kesatria.autoConnect && extension_settings.kesatria.enabled) {
        startPolling();
    }
    
    updateUI();
    console.log('[⚔️ Kesatria] v2.1 loaded — Warrior Command Center ready');
});

// ─── Render Panel ───────────────────────────────
async function renderSettingsPanel() {
    try {
        const html = await $.get('scripts/extensions/third-party/kesatria-penghubung-baja-hitam/html/settings.html');
        return html;
    } catch (error) {
        debugLog('Template load failed:', error);
        return '';
    }
}
