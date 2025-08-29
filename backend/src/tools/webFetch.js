import axios from 'axios';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export const webFetchTool = {
  name: 'web_fetch',
  description: 'Fetch and extract readable content from web pages',
  schema: {
    type: 'object',
    properties: {
      urls: { type: 'array', items: { type: 'string', format: 'uri' }, description: 'URLs to fetch content from', maxItems: 5 },
      extract_mode: { type: 'string', enum: ['readable', 'full', 'metadata'], default: 'readable', description: 'Content extraction mode' }
    },
    required: ['urls']
  },
  async handler(args, context) {
    const { urls, extract_mode = 'readable' } = args;
    const { logger, conversationId } = context;
    const results = [];
    const MAX_CONTENT_LENGTH = 10000;

    for (const url of urls.slice(0, 5)) {
      try {
        logger?.info({ event: 'tool_call', tool: 'web_fetch', url, conversationId });
        const response = await axios.get(url, {
          timeout: Number(process.env.WEB_FETCH_TIMEOUT || 10000),
          maxContentLength: Number(process.env.WEB_FETCH_MAX_SIZE || 1024 * 1024),
          headers: { 'User-Agent': 'AI-Assistant-Bot/1.0' }
        });

        if (extract_mode === 'metadata') {
          results.push({ url, title: extractTitle(response.data), content_type: response.headers['content-type'], status: 'success' });
          continue;
        }

        if (extract_mode === 'readable') {
          const dom = new JSDOM(response.data, { url });
          const reader = new Readability(dom.window.document);
          const article = reader.parse();
          if (article) {
            results.push({ url, title: article.title, content: (article.textContent || '').slice(0, MAX_CONTENT_LENGTH), excerpt: article.excerpt, byline: article.byline, length: article.length, status: 'success' });
          } else {
            results.push({ url, error: 'Could not extract readable content', status: 'failed' });
          }
        } else {
          results.push({ url, content: String(response.data).slice(0, MAX_CONTENT_LENGTH), content_type: response.headers['content-type'], status: 'success' });
        }
      } catch (error) {
        logger?.warn({ event: 'tool_error', tool: 'web_fetch', url, error: error.message, conversationId });
        results.push({ url, error: error.message, status: 'failed' });
      }
    }

    logger?.info({ event: 'tool_result', tool: 'web_fetch', urls_processed: results.length, success_count: results.filter(r => r.status === 'success').length, conversationId });

    return { results, fetch_metadata: { timestamp: new Date().toISOString(), mode: extract_mode, total_urls: urls.length, processed_urls: results.length } };
  },
  metadata: { category: 'web', rate_limit: '20/minute', cache_ttl: 600000 }
};

function extractTitle(html) {
  const m = String(html).match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : 'Untitled';
}


