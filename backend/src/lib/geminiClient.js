/**
 * Google Gemini Client Configuration
 * 
 * Provides a configured Google Gemini client instance for generative AI operations.
 * Supports multiple environment variable names for API key flexibility.
 */

import { GoogleGenAI } from '@google/genai';

// Support multiple environment variable names for Google API key
const apiKey = process.env.GEMINI_API_KEY || 
               process.env.GOOGLE_API_KEY || 
               process.env.GENERATIVE_LANGUAGE_API_KEY;

/**
 * Creates and returns a configured Google Gemini client instance
 * @returns {GoogleGenAI} Configured Gemini client
 * @throws {Error} If API key is not configured
 */
export function getGeminiClient() {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY / GENERATIVE_LANGUAGE_API_KEY) environment variable is not set');
  }
  return new GoogleGenAI({ apiKey });
}

/**
 * Set of supported Gemini model names
 * Used for routing requests to the appropriate provider
 */
export const GEMINI_SUPPORTED_MODELS = new Set([
  'gemini-2.5-pro',
  'gemini-2.5-flash'
]);
