/**
 * Conversation Store Management
 * 
 * Provides a hybrid storage solution with in-memory caching and database persistence.
 * Maintains conversation state for active sessions while persisting to SQLite.
 * 
 * Features:
 * - In-memory cache for fast access to recent conversations
 * - Database persistence for long-term storage
 * - Automatic cleanup of old conversations
 * - Dual format support (legacy messages + standardized transcript)
 */

import { conversationDb } from './database.js';

const DEFAULT_TTL_MS = 1000 * 60 * 60 * 2; // 2 hours cache TTL

/**
 * ConversationStore manages conversation state with caching and persistence
 */
class ConversationStore {
	constructor(options = {}) {
		this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
		// In-memory cache for fast access (Map: id -> conversation data)
		this.store = new Map();
		// Periodic cleanup of expired cache entries
		this.cleanupInterval = setInterval(() => this.cleanup(), Math.min(this.ttlMs, 60_000));
		this.db = conversationDb;
	}

	/**
	 * Creates a new conversation with a unique ID
	 * @returns {string} Generated conversation ID
	 */
	createConversation() {
		const id = `c_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
		const now = Date.now();
		
		// Create in database
		this.db.createConversation(id);
		
		// Create in memory cache
		this.store.set(id, {
			messages: [],
			updatedAt: now,
			transcript: {
				chatId: id,
				createdAt: now,
				updatedAt: now,
				chatHistory: []
			}
		});
		return id;
	}

	/**
	 * Appends a message to a conversation
	 * Saves to both database and cache for reliability and performance
	 * @param {string} conversationId - Conversation ID
	 * @param {string} role - Message role (user, assistant, system)
	 * @param {string} content - Message content
	 * @param {Object} details - Additional details (model, provider, usage)
	 * @returns {boolean} Success status
	 */
	appendMessage(conversationId, role, content, details = {}) {
		// Save to database first
		try {
			this.db.addMessage(conversationId, role, content, details);
		} catch (err) {
			console.error('Failed to save message to database:', err);
			// Continue with in-memory operation even if DB fails
		}
		
		// Update in-memory cache
		const convo = this.store.get(conversationId);
		if (!convo) {
			// If not in cache, try to load from database
			const dbConvo = this.db.getStandardizedConversation(conversationId);
			if (dbConvo) {
				this._loadConversationToCache(conversationId, dbConvo);
				return true;
			}
			return false;
		}
		
		const now = Date.now();
		convo.messages.push({ role, content });
		convo.updatedAt = now;
		
		// Maintain standardized transcript alongside raw messages
		if (!convo.transcript) {
			convo.transcript = { chatId: conversationId, createdAt: now, updatedAt: now, chatHistory: [] };
		}
		const entry = { role, content, at: now };
		// Only attach recognized metadata keys to avoid bloat
		if (details && typeof details === 'object') {
			const { model, provider, usage } = details;
			if (model) entry.model = model;
			if (provider) entry.provider = provider;
			if (usage) entry.usage = usage;
			if (details.tool_calls) entry.tool_calls = details.tool_calls;
			if (details.tool_name) entry.tool_name = details.tool_name;
			if (details.tool_call_id) entry.tool_call_id = details.tool_call_id;
		}
		convo.transcript.chatHistory.push(entry);
		convo.transcript.updatedAt = now;
		return true;
	}

	getMessages(conversationId) {
		const convo = this.store.get(conversationId);
		if (convo) {
			return convo.messages.slice();
		}
		
		// Fallback to database if not in cache
		try {
			const messages = this.db.getConversationMessages(conversationId);
			return messages.map(msg => ({ role: msg.role, content: msg.content }));
		} catch (err) {
			console.error('Failed to get messages from database:', err);
			return null;
		}
	}

	/**
	 * Returns the standardized transcript for this conversation.
	 */
	getConversation(conversationId) {
		const convo = this.store.get(conversationId);
		if (convo && convo.transcript) {
			// Return a shallow clone to prevent external mutations
			return {
				chatId: convo.transcript.chatId,
				createdAt: convo.transcript.createdAt,
				updatedAt: convo.transcript.updatedAt,
				chatHistory: convo.transcript.chatHistory.slice()
			};
		}
		
		// Fallback to database
		try {
			return this.db.getStandardizedConversation(conversationId);
		} catch (err) {
			console.error('Failed to get conversation from database:', err);
			return null;
		}
	}

	/**
	 * Helper method to load conversation from database into cache
	 */
	_loadConversationToCache(conversationId, dbConvo) {
		if (!dbConvo) return;
		
		this.store.set(conversationId, {
			messages: dbConvo.chatHistory.map(entry => ({ 
				role: entry.role, 
				content: entry.content 
			})),
			updatedAt: dbConvo.updatedAt,
			transcript: {
				chatId: dbConvo.chatId,
				createdAt: dbConvo.createdAt,
				updatedAt: dbConvo.updatedAt,
				chatHistory: dbConvo.chatHistory.slice()
			}
		});
	}

	touch(conversationId) {
		const convo = this.store.get(conversationId);
		if (convo) convo.updatedAt = Date.now();
	}

	delete(conversationId) {
		// Delete from database
		try {
			this.db.deleteConversationById(conversationId);
		} catch (err) {
			console.error('Failed to delete conversation from database:', err);
		}
		
		// Delete from cache
		return this.store.delete(conversationId);
	}

	getMeta(conversationId) {
		const convo = this.store.get(conversationId);
		if (convo) {
			return { updatedAt: convo.updatedAt, messagesCount: convo.messages.length };
		}
		
		// Fallback to database
		try {
			const dbConvo = this.db.getConversationById(conversationId);
			if (!dbConvo) return null;
			
			const messages = this.db.getConversationMessages(conversationId);
			return { updatedAt: dbConvo.updated_at, messagesCount: messages.length };
		} catch (err) {
			console.error('Failed to get conversation meta from database:', err);
			return null;
		}
	}

	cleanup() {
		const now = Date.now();
		
		// Clean up in-memory cache
		for (const [id, convo] of this.store.entries()) {
			if (now - convo.updatedAt > this.ttlMs) {
				this.store.delete(id);
			}
		}
		
		// Clean up old conversations in database (optional - keep longer than cache)
		try {
			const dbCleanupAge = this.ttlMs * 7; // Keep in DB 7x longer than cache
			this.db.cleanup(dbCleanupAge);
		} catch (err) {
			console.error('Database cleanup failed:', err);
		}
	}

	dispose() {
		clearInterval(this.cleanupInterval);
		this.store.clear();
		try {
			this.db.close();
		} catch (err) {
			console.error('Failed to close database:', err);
		}
	}

	// New database-specific methods
	getConversationList(limit = 50, offset = 0) {
		try {
			return this.db.getConversations(limit, offset);
		} catch (err) {
			console.error('Failed to get conversation list from database:', err);
			return [];
		}
	}

	getDbStats() {
		try {
			return this.db.getStats();
		} catch (err) {
			console.error('Failed to get database stats:', err);
			return { conversations: 0, messages: 0, databaseSize: 0 };
		}
	}

	removeLastMessage(conversationId) {
		const removed = this.db.deleteLastMessage(conversationId);
		const convo = this.store.get(conversationId);
		if (convo && removed) {
			convo.messages.pop();
			if (convo.transcript && convo.transcript.chatHistory) {
				convo.transcript.chatHistory.pop();
			}
			convo.updatedAt = Date.now();
		}
		return removed;
	}
}

export const conversationStore = new ConversationStore();
