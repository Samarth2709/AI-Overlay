import axios from 'axios';

export const webSearchTool = {
  name: 'web_search',
  description: 'Search the web for current information on any topic',
  schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query to find relevant information' },
      max_results: { type: 'number', description: 'Maximum number of results to return', default: 10, maximum: 20 },
      focus: { type: 'string', description: 'Search focus area', enum: ['general', 'news', 'academic', 'recent'], default: 'general' }
    },
    required: ['query']
  },
  async handler(args, context) {
    const { query, max_results = 10, focus = 'general' } = args;
    const { logger, conversationId } = context;

    if (!process.env.BRAVE_API_KEY) {
      throw new Error('Missing BRAVE_API_KEY');
    }

    try {
      logger?.info({ event: 'tool_call', tool: 'web_search', query, conversationId });

      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': process.env.BRAVE_API_KEY
        },
        params: {
          q: query,
          count: max_results,
          search_lang: 'en',
          country: 'US',
          safesearch: 'moderate',
          freshness: focus === 'recent' ? 'pd' : undefined
        }
      });

      const results = response.data.web?.results || [];
      const normalizedResults = results.map(r => ({
        url: r.url,
        title: r.title,
        snippet: r.description,
        published: r.age,
        favicon: r.profile?.img
      }));

      logger?.info({ event: 'tool_result', tool: 'web_search', results_count: normalizedResults.length, conversationId });

      return {
        results: normalizedResults,
        query,
        total_results: normalizedResults.length,
        search_metadata: { timestamp: new Date().toISOString(), focus, source: 'brave' }
      };
    } catch (error) {
      logger?.error({ event: 'tool_error', tool: 'web_search', error: error.message, conversationId });
      throw new Error(`Web search failed: ${error.message}`);
    }
  },
  metadata: { category: 'web', rate_limit: '10/minute', cache_ttl: 300000, requires_api_key: 'BRAVE_API_KEY' }
};


