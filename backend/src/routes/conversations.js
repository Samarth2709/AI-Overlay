import { conversationStore } from '../lib/conversationStore.js';

export default async function conversationsRoutes(app, _opts) {
	app.post('/v1/conversations', async (_request, reply) => {
		const id = conversationStore.createConversation();
		return { conversationId: id };
	});

	app.get('/v1/conversations/:id', async (request, reply) => {
		const { id } = request.params;
		const meta = conversationStore.getMeta(id);
		if (!meta) return reply.code(404).send({ error: 'Not found' });
		return { conversationId: id, ...meta };
	});

	app.delete('/v1/conversations/:id', async (request, reply) => {
		const { id } = request.params;
		const ok = conversationStore.delete(id);
		if (!ok) return reply.code(404).send({ error: 'Not found' });
		return { conversationId: id, deleted: true };
	});
}
