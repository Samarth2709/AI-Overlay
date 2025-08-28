/**
 * xAI Grok Client Configuration
 * 
 * Provides a configured xAI Grok client for chat completions.
 * Implements OpenAI-compatible API interface for consistency.
 */

// xAI API configuration
const XAI_API_BASE_URL = process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1';
const XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY;

/**
 * Creates and returns a configured Grok client instance
 * @returns {Object} Grok client with OpenAI-compatible interface
 * @throws {Error} If API key is not configured
 */
export function getGrokClient() {
  if (!XAI_API_KEY) {
    throw new Error('XAI_API_KEY (or GROK_API_KEY) environment variable is not set');
  }
  
  return {
    /**
     * Creates a chat completion using xAI Grok API
     * @param {Object} payload - Chat completion payload
     * @returns {Promise<Object>} API response
     * @throws {Error} If API request fails
     */
    async createChatCompletion(payload) {
      const res = await fetch(`${XAI_API_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${XAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`xAI API error ${res.status}: ${text}`);
      }
      
      return res.json();
    }
  };
}

/**
 * Set of supported Grok model names
 * Used for routing requests to the appropriate provider
 */
export const GROK_SUPPORTED_MODELS = new Set(['grok-4']);

