import OpenAI from 'openai';
import { BaseProviderAdapter } from './baseAdapter.js';

export class OpenAIAdapter extends BaseProviderAdapter {
  formatTools(names) {
    return this.toolRegistry.getOpenAITools(names);
  }

  async callWithTools(model, messages, tools, options = {}) {
    const payload = { model, messages, tools, tool_choice: 'auto' };
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
    // Map results back to provider-specific tool response messages
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

export function createOpenAIAdapter(toolRegistry) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || process.env.OPENAIAPI_KEY });
  return new OpenAIAdapter(client, toolRegistry);
}


