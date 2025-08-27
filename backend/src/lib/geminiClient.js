    import { GoogleGenAI } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GENERATIVE_LANGUAGE_API_KEY;

export function getGeminiClient() {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY / GENERATIVE_LANGUAGE_API_KEY) is not set');
  }
  return new GoogleGenAI({ apiKey });
}

export const GEMINI_SUPPORTED_MODELS = new Set([
  'gemini-2.5-pro',
  'gemini-2.5-flash'
]);


