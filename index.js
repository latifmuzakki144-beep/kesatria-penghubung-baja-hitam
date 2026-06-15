/**
 * ⚔️ Kesatria Penghubung Baja Hitam
 * SillyTavern Extension - OpenClaw Bridge
 * 
 * Connects SillyTavern to Termux/OpenClaw via bridge server
 */

// Import SillyTavern APIs
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    getRequestHeaders,
} from '../../../script.js';

import {
    extension_settings,
    renderExtensionTemplateAsync,
} from '../../extensions.js';

// Default settings
const defaultSettings = {
    enabled: false,
    bridgeUrl: '',
    sessionId: `session-${Math.random().toString(36).substring(2, 15)}`,
    autoConnect: false,
    pollingInterval: 2000,
    debugMode: false,
};

// Bridge state
let bridgeState = {
    status: 'disconnected', // disconnected, connected, processing, error
    lastMessage: '',
    pollingTimer: null,
    isProcessing: false,
};

/**
 * Initialize extension settings
 */
function loadSettings() {
    if (!extension_settings.kesatria) {
        extension_settings.kesatria = { ...defaultSettings };
    }
    
    // Ensure all default keys exist
    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings.kesatria[key] === undefined) {
            extension_settings.kesatria[key] = defaultSettings[key];
        }
    }
}

/**
 * Save settings to SillyTavern
 */
function saveSettings() {
    saveSettingsDebounced();
}

/**
 * Log debug messages
 */
function debugLog(...args) {
    if (extension_settings.kesatria?.debugMode) {
        console.log('[⚔️ Kesatria]', ...args);
    }
}

/**
 * Update bridge status UI
 */
function updateStatusUI() {
    const statusDot = document.getElementById('kesatria-status-dot');
    const statusText = document.getElementById('kesatria-status-text');
    const lastMsg = document.getElementById('kesatria-last-message');
    
    if (statusDot) {
        statusDot.className = `kesatria-status-dot kesatria-status-${bridgeState.status}`;
    }
    
    if (statusText) {
        statusText.textContent = bridgeState.status.toUpperCase();
        statusText.className = `kesatria-status-text kesatria-status-${bridgeState.status}`;
    }
    
    if (lastMsg && bridgeState.lastMessage) {
        lastMsg.textContent = bridgeState.lastMessage;
        lastMsg.style.display = 'block';
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            if (lastMsg) lastMsg.style.display = 'none';
        }, 5000);
    }
}

/**
 * Register session with bridge server
 */
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

/**
 * Poll bridge server for pending requests
 */
async function pollBridge() {
    const settings = extension_settings.kesatria;
    if (!settings?.enabled || !settings?.bridgeUrl || bridgeState.isProcessing) {
        return;
    }
    
    try {
        const cleanUrl = settings.bridgeUrl.replace(/\/$/, '');
        const response = await fetch(`${cleanUrl}/poll?session_id=${settings.sessionId}`, {
            headers: {
                'Accept': 'application/json',
                'ngrok-skip-browser-warning': 'true',
                'Bypass-Tunnel-Reminder': 'true',
            },
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            throw new Error('Expected JSON response');
        }
        
        const data = await response.json();
        
        // Update status to connected
        if (bridgeState.status !== 'connected') {
            bridgeState.status = 'connected';
            updateStatusUI();
        }
        
        // Handle pending request
        if (data.has_pending_request && data.request) {
            await handleBridgeRequest(data.request);
        }
        
    } catch (error) {
        debugLog('Bridge polling failed:', error.message);
        
        if (bridgeState.status !== 'error') {
            bridgeState.status = 'error';
            bridgeState.lastMessage = `Error: ${error.message}`;
            updateStatusUI();
        }
    }
}

/**
 * Handle incoming bridge request
 */
async function handleBridgeRequest(request) {
    bridgeState.isProcessing = true;
    bridgeState.status = 'processing';
    bridgeState.lastMessage = `Processing: ${request.action || 'task'}`;
    updateStatusUI();
    
    try {
        // Build context for the AI
        const contextStr = JSON.stringify(request.context || {}, null, 2);
        const payloadStr = JSON.stringify(request.payload || {}, null, 2);
        
        const systemPrompt = `[SYSTEM: AWARENESS TRANSFER FROM OPENCLAW/TERMUX]
You are processing a request from the local Termux environment.

Action: ${request.action || 'continue_conversation'}
Context:
${contextStr}

Payload/Data:
${payloadStr}

Provide an appropriate response to return to Termux.`;

        // Use SillyTavern's generation system
        const response = await generateResponse(systemPrompt);
        
        // Send response back to bridge
        await sendBridgeResponse({
            type: 'awareness_response',
            session_id: extension_settings.kesatria.sessionId,
            status: 'success',
            message: 'Processed successfully by SillyTavern',
            data: {
                reply_text: response,
                action_suggestions: [],
                files_to_create: [],
                next_steps: 'Awaiting next command.',
            },
        });
        
        bridgeState.lastMessage = 'Response sent successfully';
        
    } catch (error) {
        debugLog('Error processing bridge request:', error);
        
        // Send error response
        await sendBridgeResponse({
            type: 'awareness_response',
            session_id: extension_settings.kesatria.sessionId,
            status: 'error',
            message: error.message || 'Internal processing error',
            data: null,
        });
        
        bridgeState.lastMessage = `Error: ${error.message}`;
    } finally {
        bridgeState.isProcessing = false;
        bridgeState.status = 'connected';
        updateStatusUI();
    }
}

/**
 * Generate response using SillyTavern's system
 */
async function generateResponse(prompt) {
    // This will use SillyTavern's chat completion system
    // For now, we'll use a simple fetch to the generate endpoint
    try {
        const response = await fetch('/api/backends/chat-completions/generate', {
            method: 'POST',
            headers: {
                ...getRequestHeaders(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: 'Process this request and provide a helpful response.' },
                ],
                model: extension_settings.kesatria?.model || 'default',
                max_tokens: 1000,
            }),
        });
        
        if (!response.ok) {
            throw new Error(`Generation failed: ${response.status}`);
        }
        
        const data = await response.json();
        return data.choices?.[0]?.message?.content || 'No response generated';
        
    } catch (error) {
        debugLog('Generation error:', error);
        throw error;
    }
}

/**
 * Send response back to bridge server
 */
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

/**
 * Start polling
 */
function startPolling() {
    const settings = extension_settings.kesatria;
    
    if (bridgeState.pollingTimer) {
        clearInterval(bridgeState.pollingTimer);
    }
    
    if (settings?.enabled && settings?.bridgeUrl) {
        debugLog('Starting polling...');
        
        // Register session first
        registerSession();
        
        // Start polling
        bridgeState.pollingTimer = setInterval(pollBridge, settings.pollingInterval || 2000);
        bridgeState.status = 'connected';
        updateStatusUI();
    }
}

/**
 * Stop polling
 */
function stopPolling() {
    if (bridgeState.pollingTimer) {
        clearInterval(bridgeState.pollingTimer);
        bridgeState.pollingTimer = null;
    }
    
    bridgeState.status = 'disconnected';
    updateStatusUI();
}

/**
 * Toggle bridge enabled state
 */
function toggleBridge() {
    const settings = extension_settings.kesatria;
    settings.enabled = !settings.enabled;
    
    if (settings.enabled) {
        startPolling();
    } else {
        stopPolling();
    }
    
    saveSettings();
    updateUI();
}

/**
 * Update UI elements
 */
function updateUI() {
    const settings = extension_settings.kesatria;
    
    // Update toggle button
    const toggleBtn = document.getElementById('kesatria-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = settings.enabled ? 'Disable' : 'Enable';
        toggleBtn.className = `menu_button ${settings.enabled ? 'danger_button' : 'success_button'}`;
    }
    
    // Update settings inputs
    const urlInput = document.getElementById('kesatria-bridge-url');
    if (urlInput) {
        urlInput.value = settings.bridgeUrl || '';
    }
    
    const sessionInput = document.getElementById('kesatria-session-id');
    if (sessionInput) {
        sessionInput.value = settings.sessionId || '';
    }
    
    const autoConnectCheckbox = document.getElementById('kesatria-auto-connect');
    if (autoConnectCheckbox) {
        autoConnectCheckbox.checked = settings.autoConnect || false;
    }
    
    const debugCheckbox = document.getElementById('kesatria-debug');
    if (debugCheckbox) {
        debugCheckbox.checked = settings.debugMode || false;
    }
    
    // Update status
    updateStatusUI();
}

/**
 * Render settings panel
 */
async function renderSettingsPanel() {
    try {
        const html = await renderExtensionTemplateAsync('third-party/kesatria-penghubung-baja-hitam', 'settings');
        return html;
    } catch (error) {
        debugLog('Failed to render settings template:', error);
        return '';
    }
}

/**
 * Initialize extension
 */
jQuery(async () => {
    // Load settings
    loadSettings();
    
    // Load HTML template
    const settingsHtml = await renderSettingsPanel();
    
    // Add settings to extensions panel
    const settingsContainer = document.getElementById('extensions_settings');
    if (settingsContainer) {
        settingsContainer.insertAdjacentHTML('beforeend', settingsHtml);
    }
    
    // Setup event listeners
    document.getElementById('kesatria-toggle')?.addEventListener('click', toggleBridge);
    
    document.getElementById('kesatria-bridge-url')?.addEventListener('change', (e) => {
        extension_settings.kesatria.bridgeUrl = e.target.value;
        saveSettings();
        
        // Restart polling if enabled
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
    
    // Auto-connect if enabled
    if (extension_settings.kesatria.autoConnect && extension_settings.kesatria.enabled) {
        startPolling();
    }
    
    // Update UI
    updateUI();
    
    console.log('[⚔️ Kesatria] Extension loaded successfully');
});
