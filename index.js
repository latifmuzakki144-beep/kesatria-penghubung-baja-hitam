/**
 * ⚔️ Kesatria Penghubung Baja Hitam
 * SillyTavern Extension - OpenClaw Bridge
 * 
 * Connects SillyTavern to Hermes/Termux via bridge server
 * Allows Hermes to send messages AS the user and control SillyTavern
 */

// Import SillyTavern APIs
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

// ─── Default Settings ───────────────────────────
const defaultSettings = {
    enabled: false,
    bridgeUrl: '',
    sessionId: `session-${Math.random().toString(36).substring(2, 15)}`,
    autoConnect: false,
    pollingInterval: 2000,
    debugMode: false,
};

// ─── Bridge State ───────────────────────────────
let bridgeState = {
    status: 'disconnected',
    lastMessage: '',
    pollingTimer: null,
    isProcessing: false,
    connectedAt: null,
    stats: { sent: 0, received: 0, errors: 0 },
    logEntries: [],
    uptimeTimer: null,
};

const MAX_LOG_ENTRIES = 100;

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

// ─── Activity Log ───────────────────────────────
function addLogEntry(type, message) {
    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const icons = {
        send: '➤',
        recv: '◀',
        err: '✖',
        info: '●',
        conn: '◉',
    };
    
    const entry = { type, message, time, icon: icons[type] || '●' };
    bridgeState.logEntries.unshift(entry);
    
    // Cap entries
    if (bridgeState.logEntries.length > MAX_LOG_ENTRIES) {
        bridgeState.logEntries = bridgeState.logEntries.slice(0, MAX_LOG_ENTRIES);
    }
    
    renderLogEntries();
}

function renderLogEntries() {
    const container = document.getElementById('kesatria-log-entries');
    const countBadge = document.getElementById('kesatria-log-count');
    
    if (!container) return;
    
    if (bridgeState.logEntries.length === 0) {
        container.innerHTML = '<div class="kesatria-log-empty">No activity yet</div>';
    } else {
        container.innerHTML = bridgeState.logEntries.map(entry => `
            <div class="kesatria-log-entry kesatria-log-${entry.type}">
                <span class="kesatria-log-time">${entry.time}</span>
                <span class="kesatria-log-icon">${entry.icon}</span>
                <span class="kesatria-log-msg">${escapeHtml(entry.message)}</span>
            </div>
        `).join('');
    }
    
    if (countBadge) {
        countBadge.textContent = bridgeState.logEntries.length;
    }
}

function clearLog() {
    bridgeState.logEntries = [];
    renderLogEntries();
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
    
    if (sent) sent.textContent = bridgeState.stats.sent;
    if (recv) recv.textContent = bridgeState.stats.received;
    if (errs) errs.textContent = bridgeState.stats.errors;
    
    if (uptime) {
        if (bridgeState.connectedAt) {
            const diff = Date.now() - bridgeState.connectedAt;
            const mins = Math.floor(diff / 60000);
            const hrs = Math.floor(mins / 60);
            if (hrs > 0) {
                uptime.textContent = `${hrs}h${mins % 60}m`;
            } else {
                uptime.textContent = `${mins}m`;
            }
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
    
    const statusMap = {
        disconnected: { class: 'kesatria-dot-off', label: 'OFFLINE', detail: '' },
        connected: { class: 'kesatria-dot-connected', label: 'CONNECTED', detail: 'Bridge is active' },
        processing: { class: 'kesatria-dot-processing', label: 'PROCESSING', detail: bridgeState.lastMessage },
        error: { class: 'kesatria-dot-error', label: 'ERROR', detail: bridgeState.lastMessage },
    };
    
    const s = statusMap[bridgeState.status] || statusMap.disconnected;
    
    if (dot) { dot.className = `kesatria-dot ${s.class}`; }
    if (label) {
        label.textContent = s.label;
        label.className = `kesatria-status-label${bridgeState.status === 'error' ? ' kesatria-dot-error' : ''}`;
    }
    if (detail) {
        detail.textContent = s.detail;
        detail.style.display = s.detail ? 'block' : 'none';
    }
}

// ─── Processing Bar ─────────────────────────────
function showProcessing(text) {
    const bar = document.getElementById('kesatria-processing');
    const textEl = document.getElementById('kesatria-processing-text');
    const fill = document.getElementById('kesatria-progress-bar');
    
    if (bar) bar.style.display = 'block';
    if (textEl) textEl.textContent = text || 'Processing...';
    if (fill) {
        fill.style.width = '0%';
        // Animate progress
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 15;
            if (progress > 90) progress = 90;
            fill.style.width = `${progress}%`;
        }, 500);
        bar._progressInterval = interval;
    }
}

function hideProcessing() {
    const bar = document.getElementById('kesatria-processing');
    const fill = document.getElementById('kesatria-progress-bar');
    
    if (bar && bar._progressInterval) {
        clearInterval(bar._progressInterval);
    }
    if (fill) fill.style.width = '100%';
    
    setTimeout(() => {
        if (bar) bar.style.display = 'none';
        if (fill) fill.style.width = '0%';
    }, 500);
}

// ─── Bridge Connection ──────────────────────────
async function registerSession() {
    const settings = extension_settings.kesatria;
    if (!settings?.bridgeUrl) return;
    
    try {
        const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
        const response = await fetch(`${cleanUrl}/register?session=${settings.sessionId}`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'ngrok-skip-browser-warning': 'true',
                'Bypass-Tunnel-Reminder': 'true',
            },
        });
        
        if (response.ok) {
            debugLog('Session registered successfully');
        } else {
            debugLog('Session registration failed:', response.status);
        }
    } catch (error) {
        debugLog('Session registration error:', error.message);
    }
}

async function pollBridge() {
    const settings = extension_settings.kesatria;
    if (!settings?.enabled || !settings?.bridgeUrl || bridgeState.isProcessing) return;
    
    try {
        const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
        const response = await fetch(`${cleanUrl}/poll?session_id=${settings.sessionId}`, {
            headers: {
                'Accept': 'application/json',
                'ngrok-skip-browser-warning': 'true',
                'Bypass-Tunnel-Reminder': 'true',
            },
        });
        
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Expected JSON response');
        }
        
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
        debugLog('Bridge polling failed:', error.message);
        
        if (bridgeState.status !== 'error') {
            bridgeState.status = 'error';
            bridgeState.lastMessage = error.message;
            bridgeState.stats.errors++;
            updateStatusUI();
            updateStats();
            addLogEntry('err', `Polling error: ${error.message}`);
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
            case 'send_message':
                result = await handleSendMessage(request);
                break;
            case 'get_chat_history':
                result = await handleGetChatHistory(request);
                break;
            case 'get_character_info':
                result = await handleGetCharacterInfo(request);
                break;
            case 'get_chat_list':
                result = await handleGetChatList(request);
                break;
            case 'generate':
                result = await handleGenerate(request);
                break;
            default:
                result = await handleGenericRequest(request);
                break;
        }
        
        await sendBridgeResponse({
            type: 'action_response',
            session_id: extension_settings.kesatria.sessionId,
            status: 'success',
            message: 'Processed successfully by SillyTavern',
            data: result,
        });
        
        bridgeState.stats.received++;
        bridgeState.lastMessage = `${actionLabel} completed`;
        addLogEntry('send', `Response sent (${actionLabel})`);
        
    } catch (error) {
        debugLog('Error processing bridge request:', error);
        
        await sendBridgeResponse({
            type: 'action_response',
            session_id: extension_settings.kesatria.sessionId,
            status: 'error',
            message: error.message || 'Internal processing error',
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
    const context = getContext();
    const message = request.payload?.message || request.payload?.text;
    
    if (!message) throw new Error('No message provided');
    
    debugLog('Sending message as user:', message.substring(0, 50) + '...');
    addLogEntry('info', `Sending: "${message.substring(0, 40)}..."`);
    
    const textarea = document.getElementById('send_textarea');
    const sendButton = document.getElementById('send_but');
    
    if (textarea && sendButton) {
        textarea.value = message;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        sendButton.click();
        
        await waitForGeneration();
        const lastMessage = getLastAIResponse();
        
        bridgeState.stats.sent++;
        
        return {
            success: true,
            sent_message: message,
            ai_response: lastMessage,
        };
    }
    
    throw new Error('Could not find send textarea or button');
}

async function handleGetChatHistory(request) {
    const context = getContext();
    const chat = context.chat || [];
    const limit = request.payload?.limit || 50;
    const offset = request.payload?.offset || 0;
    
    const messages = chat.slice(offset, offset + limit).map((msg, index) => ({
        index: offset + index,
        role: msg.is_user ? 'user' : 'assistant',
        name: msg.name || (msg.is_user ? 'User' : 'Character'),
        content: msg.mes || '',
        timestamp: msg.send_date || null,
        is_system: msg.is_system || false,
    }));
    
    addLogEntry('info', `Chat history: ${messages.length} messages`);
    
    return {
        total_messages: chat.length,
        offset: offset,
        limit: limit,
        messages: messages,
        character: context.name2 || 'Unknown',
        persona: context.name1 || 'User',
    };
}

async function handleGetCharacterInfo(request) {
    const context = getContext();
    
    addLogEntry('info', `Character info: ${context.name2 || 'Unknown'}`);
    
    return {
        character: {
            name: context.name2 || 'Unknown',
            description: context.description || '',
            personality: context.personality || '',
            scenario: context.scenario || '',
            first_mes: context.first_mes || '',
            avatar: context.characters?.[context.characterId]?.avatar || null,
        },
        user: {
            name: context.name1 || 'User',
            persona: context.persona || '',
        },
        chat: {
            file: context.chatId || null,
            length: (context.chat || []).length,
        },
    };
}

async function handleGetChatList(request) {
    const context = getContext();
    return {
        current_chat: context.chatId || null,
        character: context.name2 || 'Unknown',
        message: 'Full chat list requires SillyTavern API call - use browser for this',
    };
}

async function handleGenerate(request) {
    const prompt = request.payload?.prompt || request.payload?.message;
    if (!prompt) throw new Error('No prompt provided');
    
    debugLog('Generating with custom prompt:', prompt.substring(0, 50) + '...');
    addLogEntry('info', `Generating: "${prompt.substring(0, 40)}..."`);
    
    try {
        const response = await generateQuietPrompt(prompt);
        return { success: true, prompt: prompt, response: response };
    } catch (error) {
        throw new Error(`Generation failed: ${error.message}`);
    }
}

async function handleGenericRequest(request) {
    const contextStr = JSON.stringify(request.context || {}, null, 2);
    const payloadStr = JSON.stringify(request.payload || {}, null, 2);
    
    const systemPrompt = `[SYSTEM: AWARENESS TRANSFER FROM HERMES/OPENCLAW]
You are processing a request from the local environment.

Action: ${request.action || 'continue_conversation'}
Context:
${contextStr}

Payload/Data:
${payloadStr}

Provide an appropriate response.`;

    try {
        const response = await generateQuietPrompt(systemPrompt);
        return { success: true, reply_text: response };
    } catch (error) {
        throw new Error(`Generation failed: ${error.message}`);
    }
}

// ─── Helpers ────────────────────────────────────
function waitForGeneration() {
    return new Promise((resolve) => {
        const checkInterval = 500;
        let maxWait = 60000;
        let waited = 0;
        
        const check = () => {
            const context = getContext();
            const isGenerating = context.generating || false;
            
            if (!isGenerating || waited >= maxWait) {
                setTimeout(resolve, 1000);
                return;
            }
            
            waited += checkInterval;
            setTimeout(check, checkInterval);
        };
        
        setTimeout(check, 1000);
    });
}

function getLastAIResponse() {
    const context = getContext();
    const chat = context.chat || [];
    
    for (let i = chat.length - 1; i >= 0; i--) {
        if (!chat[i].is_user) {
            return {
                content: chat[i].mes || '',
                name: chat[i].name || 'Character',
                index: i,
            };
        }
    }
    return null;
}

async function sendBridgeResponse(payload) {
    const settings = extension_settings.kesatria;
    if (!settings?.bridgeUrl) return;
    
    try {
        const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
        await fetch(`${cleanUrl}/response`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true',
                'Bypass-Tunnel-Reminder': 'true',
            },
            body: JSON.stringify(payload),
        });
        debugLog('Response sent to bridge');
    } catch (error) {
        debugLog('Failed to send response to bridge:', error);
    }
}

// ─── Polling Control ────────────────────────────
function startPolling() {
    const settings = extension_settings.kesatria;
    
    if (bridgeState.pollingTimer) {
        clearInterval(bridgeState.pollingTimer);
    }
    
    if (settings?.enabled && settings?.bridgeUrl) {
        debugLog('Starting polling...');
        registerSession();
        bridgeState.pollingTimer = setInterval(pollBridge, settings.pollingInterval || 2000);
        bridgeState.status = 'connected';
        bridgeState.connectedAt = Date.now();
        updateStatusUI();
        updateStats();
        startUptimeTimer();
        addLogEntry('conn', `Polling started: ${settings.bridgeUrl}`);
    }
}

function stopPolling() {
    if (bridgeState.pollingTimer) {
        clearInterval(bridgeState.pollingTimer);
        bridgeState.pollingTimer = null;
    }
    
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
    
    if (settings.enabled) {
        startPolling();
    } else {
        stopPolling();
    }
    
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
            btn.innerHTML = '<span class="kesatria-btn-icon-inner">⏹</span><span>Disable Bridge</span>';
        } else {
            btn.className = 'kesatria-btn-main kesatria-btn-enable';
            btn.innerHTML = '<span class="kesatria-btn-icon-inner">⚡</span><span>Enable Bridge</span>';
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
    
    if (!settings?.bridgeUrl) {
        addLogEntry('err', 'No bridge URL configured');
        return;
    }
    
    if (btn) {
        btn.textContent = '⏳ Testing...';
        btn.disabled = true;
    }
    
    try {
        const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
        const response = await fetch(`${cleanUrl}/health`, {
            headers: {
                'Accept': 'application/json',
                'ngrok-skip-browser-warning': 'true',
                'Bypass-Tunnel-Reminder': 'true',
            },
        });
        
        if (response.ok) {
            const data = await response.json();
            addLogEntry('conn', `Connection OK — ${data.sessions || 0} sessions active`);
        } else {
            addLogEntry('err', `Connection failed: HTTP ${response.status}`);
        }
    } catch (error) {
        addLogEntry('err', `Connection failed: ${error.message}`);
    } finally {
        if (btn) {
            btn.textContent = '⚡ Test';
            btn.disabled = false;
        }
    }
}

// ─── Quick Actions ──────────────────────────────
function setupQuickActions() {
    // Quick action buttons
    document.querySelectorAll('.kesatria-quick-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            
            if (action === 'send_message') {
                const sendInput = document.getElementById('kesatria-send-input');
                if (sendInput) {
                    sendInput.style.display = sendInput.style.display === 'none' ? 'block' : 'none';
                }
                return;
            }
            
            if (!extension_settings.kesatria?.enabled) {
                addLogEntry('err', 'Bridge not enabled');
                return;
            }
            
            addLogEntry('info', `Quick action: ${action}`);
            showProcessing(`Running ${action}...`);
            
            try {
                const cleanUrl = extension_settings.kesatria.bridgeUrl.replace(/\/$/, '');
                const response = await fetch(`${cleanUrl}/submit`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: JSON.stringify({
                        session_id: extension_settings.kesatria.sessionId,
                        action: action,
                        payload: action === 'get_chat_history' ? { limit: 10 } : {},
                    }),
                });
                
                if (response.ok) {
                    addLogEntry('send', `${action} submitted`);
                } else {
                    addLogEntry('err', `Submit failed: HTTP ${response.status}`);
                }
            } catch (error) {
                addLogEntry('err', `Submit failed: ${error.message}`);
            } finally {
                hideProcessing();
            }
        });
    });
    
    // Send message confirm
    document.getElementById('kesatria-send-confirm')?.addEventListener('click', async () => {
        const textArea = document.getElementById('kesatria-send-text');
        const message = textArea?.value?.trim();
        
        if (!message) {
            addLogEntry('err', 'No message to send');
            return;
        }
        
        if (!extension_settings.kesatria?.enabled) {
            addLogEntry('err', 'Bridge not enabled');
            return;
        }
        
        addLogEntry('info', `Sending: "${message.substring(0, 40)}..."`);
        showProcessing('Sending message...');
        
        try {
            const cleanUrl = extension_settings.kesatria.bridgeUrl.replace(/\/$/, '');
            const response = await fetch(`${cleanUrl}/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    session_id: extension_settings.kesatria.sessionId,
                    action: 'send_message',
                    payload: { message: message },
                }),
            });
            
            if (response.ok) {
                addLogEntry('send', 'Message submitted');
                textArea.value = '';
                document.getElementById('kesatria-send-input').style.display = 'none';
            } else {
                addLogEntry('err', `Submit failed: HTTP ${response.status}`);
            }
        } catch (error) {
            addLogEntry('err', `Submit failed: ${error.message}`);
        } finally {
            hideProcessing();
        }
    });
    
    // Send message cancel
    document.getElementById('kesatria-send-cancel')?.addEventListener('click', () => {
        document.getElementById('kesatria-send-input').style.display = 'none';
    });
}

// ─── Collapsible Sections ───────────────────────
function setupCollapsibles() {
    document.querySelectorAll('.kesatria-collapsible').forEach(title => {
        title.addEventListener('click', () => {
            const section = title.closest('.kesatria-section');
            const panel = section?.querySelector('[id$="-panel"]');
            const chevron = title.querySelector('.kesatria-chevron');
            
            if (panel) {
                const isHidden = panel.style.display === 'none';
                panel.style.display = isHidden ? 'block' : 'none';
                if (chevron) chevron.classList.toggle('kesatria-chevron-up', isHidden);
            }
        });
    });
}

// ─── Initialize ─────────────────────────────────
jQuery(async () => {
    loadSettings();
    
    // Load HTML template
    const settingsHtml = await renderSettingsPanel();
    const settingsContainer = document.getElementById('extensions_settings');
    if (settingsContainer) {
        settingsContainer.insertAdjacentHTML('beforeend', settingsHtml);
    }
    
    // ─── Event Listeners ───
    document.getElementById('kesatria-toggle')?.addEventListener('click', toggleBridge);
    
    document.getElementById('kesatria-bridge-url')?.addEventListener('change', (e) => {
        extension_settings.kesatria.bridgeUrl = e.target.value;
        saveSettings();
        if (extension_settings.kesatria.enabled) {
            stopPolling();
            startPolling();
        }
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
        if (extension_settings.kesatria.enabled) {
            stopPolling();
            startPolling();
        }
    });
    
    document.getElementById('kesatria-test-btn')?.addEventListener('click', testConnection);
    
    document.getElementById('kesatria-copy-session')?.addEventListener('click', () => {
        const sessionInput = document.getElementById('kesatria-session-id');
        if (sessionInput) {
            navigator.clipboard.writeText(sessionInput.value).then(() => {
                addLogEntry('info', 'Session ID copied to clipboard');
            }).catch(() => {
                sessionInput.select();
                document.execCommand('copy');
                addLogEntry('info', 'Session ID copied');
            });
        }
    });
    
    document.getElementById('kesatria-log-clear')?.addEventListener('click', clearLog);
    
    // Setup collapsible sections
    setupCollapsibles();
    
    // Setup quick actions
    setupQuickActions();
    
    // Auto-connect if enabled
    if (extension_settings.kesatria.autoConnect && extension_settings.kesatria.enabled) {
        startPolling();
    }
    
    // Initial UI update
    updateUI();
    
    console.log('[⚔️ Kesatria] Extension loaded successfully - Warrior Command Center ready');
});

// ─── Render Settings Panel ──────────────────────
async function renderSettingsPanel() {
    try {
        const extensionFolderPath = 'scripts/extensions/third-party/kesatria-penghubung-baja-hitam';
        const html = await $.get(`${extensionFolderPath}/html/settings.html`);
        return html;
    } catch (error) {
        debugLog('Failed to render settings template:', error);
        return '';
    }
}
