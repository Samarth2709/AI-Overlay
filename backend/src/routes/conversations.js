import { conversationStore } from '../lib/conversationStore.js';

export default async function conversationsRoutes(app, _opts) {
	app.post('/v1/conversations', async (_request, reply) => {
		const id = conversationStore.createConversation();
		return { conversationId: id };
	});

	app.get('/v1/conversations/:id', async (request, reply) => {
		const { id } = request.params;
		const conversation = conversationStore.getConversation(id);
		if (!conversation) return reply.code(404).send({ error: 'Not found' });
		return { conversationId: id, conversation };
	});

	app.get('/v1/conversations', async (request, reply) => {
		const limit = parseInt(request.query.limit) || 50;
		const offset = parseInt(request.query.offset) || 0;
		const conversations = conversationStore.getConversationList(limit, offset);
		const stats = conversationStore.getDbStats();
		return { conversations, stats, pagination: { limit, offset } };
	});

	app.delete('/v1/conversations/:id', async (request, reply) => {
		const { id } = request.params;
		const ok = conversationStore.delete(id);
		if (!ok) return reply.code(404).send({ error: 'Not found' });
		return { conversationId: id, deleted: true };
	});
}
