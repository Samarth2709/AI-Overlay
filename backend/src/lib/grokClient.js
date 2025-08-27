const XAI_API_BASE_URL = process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1';
const XAI_API_KEY = process.env.XAI_API_KEY || process.env.GROK_API_KEY;

export function getGrokClient() {
  if (!XAI_API_KEY) {
    throw new Error('XAI_API_KEY (or GROK_API_KEY) is not set');
  }
  return {
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
        throw new Error(`xAI error ${res.status}: ${text}`);
      }
      return res.json();
    }
  };
}

export const GROK_SUPPORTED_MODELS = new Set(['grok-4']);


