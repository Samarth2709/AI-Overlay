import { createOpenAIAdapter } from './openaiAdapter.js';
import { createGeminiAdapter } from './geminiAdapter.js';
import { createGrokAdapter } from './grokAdapter.js';

export function createProviderAdapter(provider, toolRegistry) {
  if (provider === 'gemini') return createGeminiAdapter(toolRegistry);
  if (provider === 'grok') return createGrokAdapter(toolRegistry);
  return createOpenAIAdapter(toolRegistry);
}


