export default async function modelsRoutes(app, _opts) {
	app.get('/v1/models', async (request, reply) => {
		// Return the requested set of models (OpenAI + Gemini)
		const models = [
			{
				id: 'gpt-5',
				name: 'GPT-5',
				description: 'Latest flagship general-purpose model'
			},
			{
				id: 'gpt-4o-mini',
				name: 'GPT-4o Mini',
				description: 'Fast and efficient model for most tasks'
			},
			{
				id: 'gemini-2.5-pro',
				name: 'Gemini 2.5 Pro',
				description: 'Most capable Gemini model'
			},
			{
				id: 'gemini-2.5-flash',
				name: 'Gemini 2.5 Flash',
				description: 'Low-latency, cost-efficient Gemini model'
			}
			,
			{
				id: 'grok-4',
				name: 'Grok 4',
				description: 'xAI model (OpenAI-compatible chat completions)'
			}
		];

		reply.type('application/json');
		return {
			models,
			default: process.env.OPENAI_MODEL || 'gpt-4o-mini'
		};
	});
}
