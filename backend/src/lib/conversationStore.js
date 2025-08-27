const DEFAULT_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours

class ConversationStore {
	constructor(options = {}) {
		this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		this.store = new Map(); // id -> { messages: [], updatedAt: number }
		this.cleanupInterval = setInterval(() => this.cleanup(), Math.min(this.ttlMs, 60_000));
	}

	createConversation() {
		const id = `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
		this.store.set(id, { messages: [], updatedAt: Date.now() });
		return id;
	}

	appendMessage(conversationId, role, content) {
		const convo = this.store.get(conversationId);
		if (!convo) return false;
		convo.messages.push({ role, content });
		convo.updatedAt = Date.now();
		return true;
	}

	getMessages(conversationId) {
		const convo = this.store.get(conversationId);
		return convo ? convo.messages.slice() : null;
	}

	touch(conversationId) {
		const convo = this.store.get(conversationId);
		if (convo) convo.updatedAt = Date.now();
	}

	delete(conversationId) {
		return this.store.delete(conversationId);
	}

	getMeta(conversationId) {
		const convo = this.store.get(conversationId);
		if (!convo) return null;
		return { updatedAt: convo.updatedAt, messagesCount: convo.messages.length };
	}

	cleanup() {
		const now = Date.now();
		for (const [id, convo] of this.store.entries()) {
			if (now - convo.updatedAt > this.ttlMs) {
				this.store.delete(id);
			}
		}
	}

	dispose() {
		clearInterval(this.cleanupInterval);
		this.store.clear();
	}
}

export const conversationStore = new ConversationStore();
