import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAIAPI_KEY;

export function getOpenAIClient() {
	if (!apiKey) {
		throw new Error('OPENAI_API_KEY (or OPENAIAPI_KEY) is not set');
	}
	return new OpenAI({ apiKey });
}
