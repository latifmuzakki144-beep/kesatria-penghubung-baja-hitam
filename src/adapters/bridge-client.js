const DEFAULT_HEADERS = {
    Accept: 'application/json',
    'ngrok-skip-browser-warning': 'true',
    'Bypass-Tunnel-Reminder': 'true',
};

function trimUrl(url = '') {
    return url.trim().replace(/\/$/, '');
}

export class BridgeClient {
    constructor({ getSettings, onRequest, onState, logger } = {}) {
        this.getSettings = getSettings;
        this.onRequest = onRequest;
        this.onState = onState || (() => {});
        this.logger = logger || (() => {});
        this.running = false;
        this.timer = null;
        this.controller = null;
        this.failureCount = 0;
        this.state = {
            status: 'offline',
            latency: null,
            lastError: '',
            connectedAt: null,
            lastPollAt: null,
            pollCount: 0,
        };
    }

    headers(extra = {}) {
        const settings = this.getSettings();
        const headers = { ...DEFAULT_HEADERS, ...extra };
        if (settings.authToken) headers.Authorization = `Bearer ${settings.authToken}`;
        return headers;
    }

    setState(patch) {
        this.state = { ...this.state, ...patch };
        this.onState({ ...this.state });
    }

    async fetchJson(path, options = {}, timeoutMs = 15000) {
        const settings = this.getSettings();
        const baseUrl = trimUrl(settings.bridgeUrl);
        if (!baseUrl) throw new Error('Bridge URL is empty');

        const controller = new AbortController();
        this.controller = controller;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const startedAt = performance.now();

        try {
            const response = await fetch(`${baseUrl}${path}`, {
                ...options,
                headers: this.headers(options.headers),
                signal: controller.signal,
            });

            const latency = Math.round(performance.now() - startedAt);
            const contentType = response.headers.get('content-type') || '';
            const data = contentType.includes('application/json') ? await response.json() : null;

            if (!response.ok) {
                throw new Error(data?.message || `Bridge HTTP ${response.status}`);
            }

            return { data, latency, response };
        } finally {
            clearTimeout(timeoutId);
            if (this.controller === controller) this.controller = null;
        }
    }

    async register() {
        const settings = this.getSettings();
        const query = new URLSearchParams({ session: settings.sessionId });
        await this.fetchJson(`/register?${query}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                protocol: 'kesatria/3',
                client: 'sillytavern-extension',
                mode: settings.mode,
                capabilities: settings.capabilities || [],
            }),
        });
    }

    async test() {
        const { data, latency } = await this.fetchJson('/health', {}, 10000);
        return { ...(data || {}), latency };
    }

    async start() {
        this.stop({ silent: true });
        const settings = this.getSettings();
        if (!settings.bridgeUrl) throw new Error('Bridge URL is empty');

        this.running = true;
        this.failureCount = 0;
        this.setState({ status: 'connecting', lastError: '' });

        try {
            await this.register();
        } catch (error) {
            this.logger('warn', `Registration failed: ${error.message}`);
        }

        this.schedule(0);
    }

    stop({ silent = false } = {}) {
        this.running = false;
        clearTimeout(this.timer);
        this.timer = null;
        this.controller?.abort();
        this.controller = null;
        this.failureCount = 0;
        this.setState({
            status: 'offline',
            latency: null,
            connectedAt: null,
            lastError: silent ? this.state.lastError : '',
        });
    }

    schedule(delay) {
        clearTimeout(this.timer);
        if (!this.running) return;
        this.timer = setTimeout(() => void this.poll(), delay);
    }

    async poll() {
        if (!this.running) return;
        const settings = this.getSettings();
        const query = new URLSearchParams({ session_id: settings.sessionId });

        try {
            const { data, latency } = await this.fetchJson(`/poll?${query}`, {}, Math.max(10000, settings.pollingInterval * 4));
            const wasConnected = this.state.status === 'connected';
            this.failureCount = 0;
            this.setState({
                status: 'connected',
                latency,
                lastError: '',
                connectedAt: this.state.connectedAt || Date.now(),
                lastPollAt: Date.now(),
                pollCount: this.state.pollCount + 1,
            });

            if (!wasConnected) this.logger('success', `Bridge connected (${latency}ms)`);

            if (data?.has_pending_request && data.request) {
                await this.onRequest(data.request);
            }

            this.schedule(Math.max(750, Number(settings.pollingInterval) || 2000));
        } catch (error) {
            if (!this.running) return;
            this.failureCount += 1;
            const base = Math.max(1000, Number(settings.pollingInterval) || 2000);
            const backoff = Math.min(30000, base * (2 ** Math.min(this.failureCount - 1, 4)));
            this.setState({ status: 'error', lastError: error.message, latency: null });
            this.logger('error', `Bridge poll failed; retry in ${Math.round(backoff / 1000)}s: ${error.message}`);
            this.schedule(backoff);
        }
    }

    async sendResponse(payload) {
        await this.fetchJson('/response', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
    }
}
