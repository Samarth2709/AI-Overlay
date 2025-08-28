/**
 * Conversation Database Management
 * 
 * Provides a SQLite-based persistence layer for conversation data.
 * Uses WAL mode for better concurrent access and prepared statements for performance.
 * 
 * Database Schema:
 * - conversations: Stores conversation metadata
 * - messages: Stores individual messages with usage tracking
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current file directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database file path - configurable via environment variable
const DB_PATH = process.env.DATABASE_PATH || path.resolve(__dirname, '../../data/conversations.db');

/**
 * ConversationDatabase class manages all database operations for conversations and messages
 */
class ConversationDatabase {
	constructor() {
		this.db = new Database(DB_PATH);
		// Enable WAL mode for better concurrent access performance
		this.db.pragma('journal_mode = WAL');
		// Enable foreign key constraints
		this.db.pragma('foreign_keys = ON');
		this.initSchema();
		this.prepareStatements();
	}

	/**
	 * Initializes database schema with tables and indexes
	 * Creates conversations and messages tables with appropriate constraints
	 */
	initSchema() {
		// Conversations table - stores conversation metadata
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS conversations (
				id TEXT PRIMARY KEY,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL,
				title TEXT,
				model TEXT,
				provider TEXT,
				metadata TEXT -- JSON string for additional data
			)
		`);

		// Messages table
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS messages (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				conversation_id TEXT NOT NULL,
				role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
				content TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				model TEXT,
				provider TEXT,
				usage_prompt_tokens INTEGER DEFAULT 0,
				usage_completion_tokens INTEGER DEFAULT 0,
				usage_total_tokens INTEGER DEFAULT 0,
				metadata TEXT, -- JSON string for additional data
				FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
			)
		`);

		// Indexes for performance
		this.db.exec(`
			CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
			CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
			CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
		`);
	}

	/**
	 * Prepares all SQL statements for better performance
	 * Pre-compiled statements are faster than dynamic SQL
	 */
	prepareStatements() {
		// Conversation statements
		this.insertConversation = this.db.prepare(`
			INSERT INTO conversations (id, created_at, updated_at, title, model, provider, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);

		this.updateConversation = this.db.prepare(`
			UPDATE conversations 
			SET updated_at = ?, title = ?, model = ?, provider = ?, metadata = ?
			WHERE id = ?
		`);

		this.getConversation = this.db.prepare(`
			SELECT * FROM conversations WHERE id = ?
		`);

		this.deleteConversation = this.db.prepare(`
			DELETE FROM conversations WHERE id = ?
		`);

		this.listConversations = this.db.prepare(`
			SELECT * FROM conversations 
			ORDER BY updated_at DESC 
			LIMIT ? OFFSET ?
		`);

		// Message statements
		this.insertMessage = this.db.prepare(`
			INSERT INTO messages (
				conversation_id, role, content, created_at, model, provider,
				usage_prompt_tokens, usage_completion_tokens, usage_total_tokens, metadata
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		this.getMessages = this.db.prepare(`
			SELECT * FROM messages 
			WHERE conversation_id = ? 
			ORDER BY created_at ASC
		`);

		this.deleteMessages = this.db.prepare(`
			DELETE FROM messages WHERE conversation_id = ?
		`);

		// Cleanup statements
		this.cleanupOldConversations = this.db.prepare(`
			DELETE FROM conversations 
			WHERE updated_at < ?
		`);
		this.deleteLastMessageStmt = this.db.prepare(`DELETE FROM messages WHERE id = (SELECT MAX(id) FROM messages WHERE conversation_id = ?)`);
		this.updateConversationTimestamp = this.db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`);
	}

	/**
	 * Creates a new conversation record
	 * @param {string} id - Unique conversation identifier
	 * @param {string|null} title - Optional conversation title
	 * @param {string|null} model - AI model used
	 * @param {string|null} provider - AI provider (openai, gemini, grok)
	 * @param {Object} metadata - Additional metadata
	 * @returns {Object} Created conversation info
	 */
	createConversation(id, title = null, model = null, provider = null, metadata = {}) {
		const now = Date.now();
		this.insertConversation.run(
			id, 
			now, 
			now, 
			title, 
			model, 
			provider, 
			JSON.stringify(metadata)
		);
		return { id, created_at: now, updated_at: now };
	}

	updateConversationMeta(id, updates = {}) {
		const now = Date.now();
		const { title, model, provider, metadata = {} } = updates;
		this.updateConversation.run(
			now,
			title,
			model,
			provider,
			JSON.stringify(metadata),
			id
		);
	}

	getConversationById(id) {
		const row = this.getConversation.get(id);
		if (!row) return null;
		
		return {
			...row,
			metadata: row.metadata ? JSON.parse(row.metadata) : {}
		};
	}

	deleteConversationById(id) {
		return this.deleteConversation.run(id).changes > 0;
	}

	getConversations(limit = 50, offset = 0) {
		const rows = this.listConversations.all(limit, offset);
		return rows.map(row => ({
			...row,
			metadata: row.metadata ? JSON.parse(row.metadata) : {}
		}));
	}

	/**
	 * Adds a message to a conversation
	 * @param {string} conversationId - Conversation ID
	 * @param {string} role - Message role (user, assistant, system)
	 * @param {string} content - Message content
	 * @param {Object} details - Additional details (model, provider, usage, metadata)
	 * @returns {Object} Added message info
	 */
	addMessage(conversationId, role, content, details = {}) {
		const now = Date.now();
		const { model, provider, usage = {}, metadata = {} } = details;
		
		this.insertMessage.run(
			conversationId,
			role,
			content,
			now,
			model || null,
			provider || null,
			usage.prompt_tokens || 0,
			usage.completion_tokens || 0,
			usage.total_tokens || 0,
			JSON.stringify(metadata)
		);

		// Update conversation timestamp
		this.updateConversationMeta(conversationId, {});
		
		return { conversation_id: conversationId, role, content, created_at: now };
	}

	getConversationMessages(conversationId) {
		const rows = this.getMessages.all(conversationId);
		return rows.map(row => ({
			...row,
			metadata: row.metadata ? JSON.parse(row.metadata) : {},
			usage: {
				prompt_tokens: row.usage_prompt_tokens,
				completion_tokens: row.usage_completion_tokens,
				total_tokens: row.usage_total_tokens
			}
		}));
	}

	// Get standardized conversation format
	getStandardizedConversation(conversationId) {
		const conversation = this.getConversationById(conversationId);
		if (!conversation) return null;

		const messages = this.getConversationMessages(conversationId);
		
		const chatHistory = messages.map(msg => {
			const entry = {
				role: msg.role,
				content: msg.content,
				at: msg.created_at
			};
			
			if (msg.model) entry.model = msg.model;
			if (msg.provider) entry.provider = msg.provider;
			if (msg.usage && (msg.usage.total_tokens > 0)) entry.usage = msg.usage;
			
			return entry;
		});

		return {
			chatId: conversation.id,
			createdAt: conversation.created_at,
			updatedAt: conversation.updated_at,
			chatHistory
		};
	}

	// Cleanup operations
	cleanup(maxAgeMs = 1000 * 60 * 60 * 24 * 7) { // Default: 1 week
		const cutoff = Date.now() - maxAgeMs;
		return this.cleanupOldConversations.run(cutoff).changes;
	}

	deleteLastMessage(conversationId) {
		const result = this.deleteLastMessageStmt.run(conversationId);
		if (result.changes > 0) {
			const now = Date.now();
			this.updateConversationTimestamp.run(now, conversationId);
		}
		return result.changes > 0;
	}

	// Utility methods
	close() {
		this.db.close();
	}

	getStats() {
		const conversationCount = this.db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
		const messageCount = this.db.prepare('SELECT COUNT(*) as count FROM messages').get().count;
		const dbSize = this.db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get().size;
		
		return {
			conversations: conversationCount,
			messages: messageCount,
			databaseSize: dbSize
		};
	}
}

// Create data directory if it doesn't exist
import { mkdir } from 'fs/promises';
const dataDir = path.dirname(DB_PATH);
try {
	await mkdir(dataDir, { recursive: true });
} catch (err) {
	// Directory might already exist
}

export const conversationDb = new ConversationDatabase();
