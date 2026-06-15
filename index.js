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
    getRequestHeaders,
} from '../../../../script.js';

import {
    extension_settings,
    getContext,
} from '../../../extensions.js';

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
 * Handle incoming bridge request - MAIN DISPATCHER
 */
async function handleBridgeRequest(request) {
    bridgeState.isProcessing = true;
    bridgeState.status = 'processing';
    bridgeState.lastMessage = `Processing: ${request.action || 'task'}`;
    updateStatusUI();
    
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
        
        // Send response back to bridge
        await sendBridgeResponse({
            type: 'action_response',
            session_id: extension_settings.kesatria.sessionId,
            status: 'success',
            message: 'Processed successfully by SillyTavern',
            data: result,
        });
        
        bridgeState.lastMessage = 'Response sent successfully';
        
    } catch (error) {
        debugLog('Error processing bridge request:', error);
        
        // Send error response
        await sendBridgeResponse({
            type: 'action_response',
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
 * Handle send_message - Send a message AS the user
 * This is the key feature: Hermes can send messages as if bang jek typed them
 */
async function handleSendMessage(request) {
    const context = getContext();
    const message = request.payload?.message || request.payload?.text;
    
    if (!message) {
        throw new Error('No message provided');
    }
    
    debugLog('Sending message as user:', message.substring(0, 50) + '...');
    
    // Method 1: Use the textarea + send button (most reliable)
    const textarea = document.getElementById('send_textarea');
    const sendButton = document.getElementById('send_but');
    
    if (textarea && sendButton) {
        // Set the message
        textarea.value = message;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Click send
        sendButton.click();
        
        // Wait for generation to complete
        await waitForGeneration();
        
        // Get the last AI response
        const lastMessage = getLastAIResponse();
        
        return {
            success: true,
            sent_message: message,
            ai_response: lastMessage,
        };
    }
    
    throw new Error('Could not find send textarea or button');
}

/**
 * Handle get_chat_history - Get the current chat messages
 */
async function handleGetChatHistory(request) {
    const context = getContext();
    const chat = context.chat || [];
    const limit = request.payload?.limit || 50;
    const offset = request.payload?.offset || 0;
    
    // Get messages with pagination
    const messages = chat.slice(offset, offset + limit).map((msg, index) => ({
        index: offset + index,
        role: msg.is_user ? 'user' : 'assistant',
        name: msg.name || (msg.is_user ? 'User' : 'Character'),
        content: msg.mes || '',
        timestamp: msg.send_date || null,
        is_system: msg.is_system || false,
    }));
    
    return {
        total_messages: chat.length,
        offset: offset,
        limit: limit,
        messages: messages,
        character: context.name2 || 'Unknown',
        persona: context.name1 || 'User',
    };
}

/**
 * Handle get_character_info - Get current character details
 */
async function handleGetCharacterInfo(request) {
    const context = getContext();
    
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

/**
 * Handle get_chat_list - List available chats for current character
 */
async function handleGetChatList(request) {
    // This is limited - we can only get what's in the context
    const context = getContext();
    
    return {
        current_chat: context.chatId || null,
        character: context.name2 || 'Unknown',
        message: 'Full chat list requires SillyTavern API call - use browser for this',
    };
}

/**
 * Handle generate - Generate a response with a custom prompt
 */
async function handleGenerate(request) {
    const prompt = request.payload?.prompt || request.payload?.message;
    
    if (!prompt) {
        throw new Error('No prompt provided');
    }
    
    debugLog('Generating with custom prompt:', prompt.substring(0, 50) + '...');
    
    try {
        const response = await generateQuietPrompt(prompt);
        
        return {
            success: true,
            prompt: prompt,
            response: response,
        };
    } catch (error) {
        throw new Error(`Generation failed: ${error.message}`);
    }
}

/**
 * Handle generic request - Legacy support
 */
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
        return {
            success: true,
            reply_text: response,
        };
    } catch (error) {
        throw new Error(`Generation failed: ${error.message}`);
    }
}

/**
 * Wait for AI generation to complete
 */
function waitForGeneration() {
    return new Promise((resolve) => {
        const checkInterval = 500;
        let maxWait = 60000; // 60 seconds max
        let waited = 0;
        
        const check = () => {
            const context = getContext();
            const isGenerating = context.generating || false;
            
            if (!isGenerating || waited >= maxWait) {
                // Small delay to ensure message is fully written
                setTimeout(resolve, 1000);
                return;
            }
            
            waited += checkInterval;
            setTimeout(check, checkInterval);
        };
        
        // Start checking after a small delay
        setTimeout(check, 1000);
    });
}

/**
 * Get the last AI response from chat
 */
function getLastAIResponse() {
    const context = getContext();
    const chat = context.chat || [];
    
    // Find last non-user message
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
        const extensionFolderPath = 'scripts/extensions/third-party/kesatria-penghubung-baja-hitam';
        const html = await $.get(`${extensionFolderPath}/html/settings.html`);
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
    
    console.log('[⚔️ Kesatria] Extension loaded successfully - Ready for Hermes bridge');
});
