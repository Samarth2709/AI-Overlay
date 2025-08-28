/**
 * Models API Routes
 * 
 * Provides endpoints for retrieving available AI models and their metadata.
 */

/**
 * Available AI models configuration
 * Centralized model definitions with metadata
 */
const AVAILABLE_MODELS = [
	{
		id: 'gpt-5',
		name: 'GPT-5',
		description: 'Latest flagship general-purpose model',
		provider: 'openai'
	},
	{
		id: 'gpt-4o-mini',
		name: 'GPT-4o Mini',
		description: 'Fast and efficient model for most tasks',
		provider: 'openai'
	},
	{
		id: 'gemini-2.5-pro',
		name: 'Gemini 2.5 Pro',
		description: 'Most capable Gemini model',
		provider: 'gemini'
	},
	{
		id: 'gemini-2.5-flash',
		name: 'Gemini 2.5 Flash',
		description: 'Low-latency, cost-efficient Gemini model',
		provider: 'gemini'
	},
	{
		id: 'grok-4',
		name: 'Grok 4',
		description: 'xAI model (OpenAI-compatible chat completions)',
		provider: 'grok'
	}
];

/**
 * Registers models-related routes
 * @param {Object} app - Fastify app instance
 * @param {Object} _opts - Route options (unused)
 */
export default async function modelsRoutes(app, _opts) {
	/**
	 * GET /v1/models
	 * Returns list of available AI models with metadata
	 */
	app.get('/v1/models', async (request, reply) => {
		reply.type('application/json');
		return {
			models: AVAILABLE_MODELS,
			default: process.env.OPENAI_MODEL || 'gpt-4o-mini'
		};
	});
}
