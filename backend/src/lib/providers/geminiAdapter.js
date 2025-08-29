import { GoogleGenAI } from '@google/genai';
import { BaseProviderAdapter } from './baseAdapter.js';

export class GeminiAdapter extends BaseProviderAdapter {
  formatTools(names) {
    // Gemini expects tools as { functionDeclarations: [...] }
    const toolset = this.toolRegistry.getGeminiTools(names);
    return toolset; // pass-through
  }

  async callWithTools(model, messages, tools, options = {}) {
    const payload = {
      model,
      contents: messages,
      tools,
    };
    if (options.systemInstruction) payload.systemInstruction = options.systemInstruction;
    if (options.stream) {
      // For now, use non-stream to simplify tool loop. Streaming variant can be added later.
      const res = await this.client.models.generateContent(payload);
      return res;
    }
    const res = await this.client.models.generateContent(payload);
    return res;
  }

  parseToolCalls(response) {
    // Gemini function calls: candidates[0].content.parts with functionCall
    const calls = [];
    const parts = response?.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
      if (p.functionCall?.name) {
        calls.push({ id: randomId(), name: p.functionCall.name, args: p.functionCall.args || {} });
      }
    }
    return calls;
  }

  formatToolResults(toolCalls, results) {
    // Gemini expects a functionResponse part
    const parts = [];
    for (const call of toolCalls) {
      const res = results.find(r => r.id === call.id);
      parts.push({
        role: 'function',
        parts: [{
          functionResponse: {
            name: call.name,
            response: res?.result ?? { error: res?.error || 'no result' }
          }
        }]
      });
    }
    return parts;
  }
}

function randomId() {
  return `tc_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function createGeminiAdapter(toolRegistry) {
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GENERATIVE_LANGUAGE_API_KEY });
  return new GeminiAdapter(client, toolRegistry);
}


