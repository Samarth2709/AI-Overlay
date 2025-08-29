import OpenAI from 'openai';
import { BaseProviderAdapter } from './baseAdapter.js';

// Grok is OpenAI-compatible for chat.completions API
export class GrokAdapter extends BaseProviderAdapter {
  formatTools(names) {
    return this.toolRegistry.getGrokTools(names);
  }

  async callWithTools(model, messages, tools, options = {}) {
    const payload = { model: model || 'grok-4', messages, tools, tool_choice: 'auto' };
    if (options.stream) payload.stream = true;
    const response = await this.client.chat.completions.create(payload);
    return response;
  }

  parseToolCalls(response) {
    const choice = response?.choices?.[0];
    const calls = choice?.message?.tool_calls || [];
    return calls.map(c => ({ id: c.id, name: c.function?.name, args: safeParse(c.function?.arguments) }));
  }

  formatToolResults(toolCalls, results) {
    const toolMessages = [];
    for (const call of toolCalls) {
      const res = results.find(r => r.id === call.id);
      toolMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify(res?.result ?? { error: res?.error || 'no result' })
      });
    }
    return toolMessages;
  }
}

function safeParse(json) {
  try { return json ? JSON.parse(json) : {}; } catch { return {}; }
}

export function createGrokAdapter(toolRegistry) {
  const client = new OpenAI({ 
    apiKey: process.env.XAI_API_KEY || process.env.GROK_API_KEY,
    baseURL: process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1'
  });
  return new GrokAdapter(client, toolRegistry);
}


