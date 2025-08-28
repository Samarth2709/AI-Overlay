/**
 * Conversations API Routes
 * 
 * Provides CRUD endpoints for managing conversation sessions.
 * Handles conversation creation, retrieval, listing, and deletion.
 */

import { conversationStore } from '../lib/conversationStore.js';

/**
 * Registers conversation-related routes
 * @param {Object} app - Fastify app instance
 * @param {Object} _opts - Route options (unused)
 */
export default async function conversationsRoutes(app, _opts) {
	/**
	 * POST /v1/conversations
	 * Creates a new conversation session
	 */
	app.post('/v1/conversations', async (_request, reply) => {
		const id = conversationStore.createConversation();
		return { conversationId: id };
	});

	/**
	 * GET /v1/conversations/:id
	 * Retrieves a specific conversation by ID
	 */
	app.get('/v1/conversations/:id', async (request, reply) => {
		const { id } = request.params;
		const conversation = conversationStore.getConversation(id);
		
		if (!conversation) {
			return reply.code(404).send({ error: 'Conversation not found' });
		}
		
		return { conversationId: id, conversation };
	});

	/**
	 * GET /v1/conversations
	 * Lists conversations with pagination support
	 */
	app.get('/v1/conversations', async (request, reply) => {
		const limit = parseInt(request.query.limit) || 50;
		const offset = parseInt(request.query.offset) || 0;
		
		const conversations = conversationStore.getConversationList(limit, offset);
		const stats = conversationStore.getDbStats();
		
		return { 
			conversations, 
			stats, 
			pagination: { limit, offset } 
		};
	});

	/**
	 * DELETE /v1/conversations/:id
	 * Deletes a specific conversation
	 */
	app.delete('/v1/conversations/:id', async (request, reply) => {
		const { id } = request.params;
		const deleted = conversationStore.delete(id);
		
		if (!deleted) {
			return reply.code(404).send({ error: 'Conversation not found' });
		}
		
		return { conversationId: id, deleted: true };
	});
}
