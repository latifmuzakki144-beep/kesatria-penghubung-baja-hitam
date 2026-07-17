export class StateStore {
    constructor(initialState = {}) {
        this.state = structuredClone(initialState);
        this.listeners = new Set();
    }

    get() {
        return structuredClone(this.state);
    }

    update(patch) {
        const nextPatch = typeof patch === 'function' ? patch(this.get()) : patch;
        this.state = { ...this.state, ...nextPatch };
        const snapshot = this.get();
        this.listeners.forEach(listener => listener(snapshot));
        return snapshot;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        listener(this.get());
        return () => this.listeners.delete(listener);
    }
}
