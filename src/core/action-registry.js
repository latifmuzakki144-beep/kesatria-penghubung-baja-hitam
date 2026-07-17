export class ActionRegistry {
    constructor({ permissionResolver, contextProvider } = {}) {
        this.actions = new Map();
        this.permissionResolver = permissionResolver || (() => true);
        this.contextProvider = contextProvider || (() => ({}));
    }

    register(definition) {
        if (!definition?.id || typeof definition.execute !== 'function') {
            throw new TypeError('Action definition requires an id and execute function');
        }

        if (this.actions.has(definition.id)) {
            throw new Error(`Action already registered: ${definition.id}`);
        }

        const normalized = {
            title: definition.id,
            description: '',
            category: 'Other',
            icon: '⚡',
            permission: null,
            risk: 'low',
            sources: ['local', 'remote'],
            ...definition,
        };

        this.actions.set(normalized.id, normalized);
        return normalized;
    }

    get(id) {
        return this.actions.get(id) || null;
    }

    list({ source } = {}) {
        return [...this.actions.values()]
            .filter(action => !source || action.sources.includes(source))
            .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    }

    async execute(id, payload = {}, execution = {}) {
        const action = this.get(id);
        if (!action) throw new Error(`Unknown action: ${id}`);

        const source = execution.source || 'local';
        if (!action.sources.includes(source)) {
            throw new Error(`Action ${id} is unavailable for source ${source}`);
        }

        const allowed = await this.permissionResolver(action.permission, {
            action,
            payload,
            source,
            execution,
        });

        if (!allowed) {
            throw new Error(`Permission denied: ${action.permission || action.id}`);
        }

        const context = await this.contextProvider({ action, payload, source, execution });
        return action.execute(payload, { ...context, source, execution, action });
    }
}
