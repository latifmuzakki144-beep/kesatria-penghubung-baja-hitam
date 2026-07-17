function makeId(prefix = 'task') {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function withTimeout(promise, timeoutMs, controller) {
    if (!timeoutMs || timeoutMs <= 0) return promise;

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            controller?.abort?.();
            reject(new Error(`Action timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

export class ActionQueue {
    constructor(registry, { maxHistory = 100, defaultTimeout = 120000 } = {}) {
        this.registry = registry;
        this.maxHistory = maxHistory;
        this.defaultTimeout = defaultTimeout;
        this.pending = [];
        this.history = [];
        this.active = null;
        this.listeners = new Set();
        this.processing = false;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.snapshot());
        return () => this.listeners.delete(listener);
    }

    publicItem(item) {
        if (!item) return null;
        const clean = { ...item };
        delete clean.resolve;
        delete clean.reject;
        delete clean.controller;
        return clean;
    }

    snapshot() {
        return {
            active: this.publicItem(this.active),
            pending: this.pending.map(item => this.publicItem(item)),
            history: this.history.map(item => this.publicItem(item)),
        };
    }

    emit() {
        const snapshot = this.snapshot();
        this.listeners.forEach(listener => {
            try { listener(snapshot); } catch (error) { console.error('[Kesatria Queue]', error); }
        });
    }

    enqueue({ actionId, payload = {}, source = 'local', requestId, timeoutMs } = {}) {
        if (!actionId) return Promise.reject(new Error('actionId is required'));

        const action = this.registry.get(actionId);
        if (!action) return Promise.reject(new Error(`Unknown action: ${actionId}`));

        const id = requestId || makeId(source === 'remote' ? 'remote' : 'local');
        const createdAt = Date.now();

        return new Promise((resolve, reject) => {
            this.pending.push({
                id,
                actionId,
                actionTitle: action.title,
                payload,
                source,
                status: 'queued',
                createdAt,
                timeoutMs: timeoutMs || this.defaultTimeout,
                resolve,
                reject,
            });
            this.emit();
            void this.process();
        });
    }

    cancel(id) {
        const pendingIndex = this.pending.findIndex(item => item.id === id);
        if (pendingIndex >= 0) {
            const [item] = this.pending.splice(pendingIndex, 1);
            item.status = 'cancelled';
            item.finishedAt = Date.now();
            item.reject(new Error('Action cancelled'));
            this.pushHistory(item);
            this.emit();
            return true;
        }

        if (this.active?.id === id && this.active.controller) {
            this.active.controller.abort();
            return true;
        }

        return false;
    }

    clearCompleted() {
        this.history = this.history.filter(item => !['success', 'error', 'cancelled'].includes(item.status));
        this.emit();
    }

    pushHistory(item) {
        const clean = { ...item };
        delete clean.resolve;
        delete clean.reject;
        delete clean.controller;
        this.history.unshift(clean);
        if (this.history.length > this.maxHistory) this.history.length = this.maxHistory;
    }

    async process() {
        if (this.processing) return;
        this.processing = true;

        while (this.pending.length > 0) {
            const item = this.pending.shift();
            const controller = new AbortController();
            item.controller = controller;
            item.status = 'running';
            item.startedAt = Date.now();
            this.active = item;
            this.emit();

            try {
                const result = await withTimeout(
                    this.registry.execute(item.actionId, item.payload, {
                        source: item.source,
                        requestId: item.id,
                        signal: controller.signal,
                    }),
                    item.timeoutMs,
                    controller,
                );

                item.status = 'success';
                item.result = result;
                item.finishedAt = Date.now();
                item.resolve(result);
            } catch (error) {
                item.status = controller.signal.aborted ? 'cancelled' : 'error';
                item.error = error?.message || String(error);
                item.finishedAt = Date.now();
                item.reject(error);
            } finally {
                this.pushHistory(item);
                this.active = null;
                this.emit();
            }
        }

        this.processing = false;
    }
}
