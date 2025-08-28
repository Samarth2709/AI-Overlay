/**
 * OpenAI Client Configuration
 * 
 * Provides a configured OpenAI client instance for chat completions.
 * Supports multiple environment variable names for API key flexibility.
 */

import OpenAI from 'openai';

// Support multiple environment variable names for backward compatibility
const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAIAPI_KEY;

/**
 * Creates and returns a configured OpenAI client instance
 * @returns {OpenAI} Configured OpenAI client
 * @throws {Error} If API key is not configured
 */
export function getOpenAIClient() {
	if (!apiKey) {
		throw new Error('OPENAI_API_KEY (or OPENAIAPI_KEY) environment variable is not set');
	}
	return new OpenAI({ apiKey });
}
