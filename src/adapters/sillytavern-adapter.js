function dispatchInput(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
}

function findFirst(selectors) {
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) return element;
    }
    return null;
}

export class SillyTavernAdapter {
    constructor(dependencies) {
        this.getContext = dependencies.getContext;
        this.generateQuietPrompt = dependencies.generateQuietPrompt;
        this.saveChat = dependencies.saveChat;
        this.reloadCurrentChat = dependencies.reloadCurrentChat;
    }

    context() {
        return this.getContext();
    }

    async waitForGeneration({ timeoutMs = 120000, signal } = {}) {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            if (signal?.aborted) throw new DOMException('Action aborted', 'AbortError');
            const context = this.context();
            if (!context.generating) {
                await new Promise(resolve => setTimeout(resolve, 350));
                if (!this.context().generating) return;
            }
            await new Promise(resolve => setTimeout(resolve, 350));
        }

        throw new Error('Generation did not finish before timeout');
    }

    lastAssistantMessage() {
        const chat = this.context().chat || [];
        for (let index = chat.length - 1; index >= 0; index -= 1) {
            const message = chat[index];
            if (!message.is_user && !message.is_system) {
                return {
                    index,
                    role: 'assistant',
                    name: message.name || this.context().name2 || 'Character',
                    content: message.mes || '',
                    timestamp: message.send_date || null,
                };
            }
        }
        return null;
    }

    async sendAsUser(message, { waitForReply = true, signal } = {}) {
        const text = String(message || '').trim();
        if (!text) throw new Error('Message cannot be empty');

        const textarea = document.getElementById('send_textarea');
        const sendButton = document.getElementById('send_but');
        if (!textarea || !sendButton) throw new Error('SillyTavern message composer is unavailable');
        if (this.context().generating) throw new Error('SillyTavern is currently generating a response');

        textarea.value = text;
        dispatchInput(textarea);
        sendButton.click();

        if (waitForReply) await this.waitForGeneration({ signal });
        return {
            sentMessage: text,
            reply: waitForReply ? this.lastAssistantMessage() : null,
        };
    }

    async generateQuiet(prompt) {
        const text = String(prompt || '').trim();
        if (!text) throw new Error('Prompt cannot be empty');
        const response = await this.generateQuietPrompt(text);
        return { prompt: text, response };
    }

    getChatHistory({ limit = 50, offset = 0, newestFirst = false } = {}) {
        const context = this.context();
        const chat = context.chat || [];
        const safeLimit = Math.min(500, Math.max(1, Number(limit) || 50));
        const safeOffset = Math.max(0, Number(offset) || 0);
        const source = newestFirst ? [...chat].reverse() : chat;

        const messages = source.slice(safeOffset, safeOffset + safeLimit).map((message, index) => ({
            index: newestFirst ? chat.length - 1 - (safeOffset + index) : safeOffset + index,
            role: message.is_system ? 'system' : message.is_user ? 'user' : 'assistant',
            name: message.name || (message.is_user ? context.name1 : context.name2),
            content: message.mes || '',
            timestamp: message.send_date || null,
            isSystem: Boolean(message.is_system),
        }));

        return {
            totalMessages: chat.length,
            offset: safeOffset,
            limit: safeLimit,
            newestFirst: Boolean(newestFirst),
            character: context.name2 || null,
            persona: context.name1 || null,
            messages,
        };
    }

    getCharacterInfo() {
        const context = this.context();
        const character = context.characters?.[context.characterId];
        return {
            character: {
                id: context.characterId ?? null,
                name: context.name2 || character?.name || 'Unknown',
                description: context.description || character?.description || '',
                personality: context.personality || character?.personality || '',
                scenario: context.scenario || character?.scenario || '',
                firstMessage: context.first_mes || character?.first_mes || '',
                avatar: character?.avatar || null,
            },
            user: {
                name: context.name1 || 'User',
                persona: context.persona || '',
            },
            chat: {
                id: context.chatId || null,
                messageCount: (context.chat || []).length,
                isGenerating: Boolean(context.generating),
            },
        };
    }

    getStatus() {
        const context = this.context();
        return {
            ready: true,
            character: context.name2 || null,
            persona: context.name1 || null,
            chatId: context.chatId || null,
            messageCount: (context.chat || []).length,
            generating: Boolean(context.generating),
            timestamp: new Date().toISOString(),
        };
    }

    async stopGeneration() {
        if (!this.context().generating) return { stopped: false, reason: 'No active generation' };
        const button = findFirst(['#mes_stop', '#stop_but', '.mes_stop', '[data-action="stop-generation"]']);
        if (!button) throw new Error('Stop-generation control is unavailable in this SillyTavern version');
        button.click();
        return { stopped: true };
    }

    async continueGeneration() {
        if (this.context().generating) throw new Error('A generation is already running');
        const button = findFirst(['#mes_continue', '#option_continue', '[data-action="continue"]']);
        if (!button) throw new Error('Continue control is unavailable in this SillyTavern version');
        button.click();
        await this.waitForGeneration();
        return { continued: true, reply: this.lastAssistantMessage() };
    }

    async regenerate() {
        if (this.context().generating) throw new Error('A generation is already running');
        const button = findFirst(['#option_regenerate', '#regenerate_button', '[data-action="regenerate"]']);
        if (!button) throw new Error('Regenerate control is unavailable in this SillyTavern version');
        button.click();
        await this.waitForGeneration();
        return { regenerated: true, reply: this.lastAssistantMessage() };
    }

    async save() {
        await this.saveChat();
        return { saved: true, chatId: this.context().chatId || null };
    }

    async reload() {
        await this.reloadCurrentChat();
        return { reloaded: true, chatId: this.context().chatId || null };
    }
}
