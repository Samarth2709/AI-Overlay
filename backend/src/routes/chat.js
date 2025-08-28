/**
 * Chat API Routes
 * 
 * Provides chat completion endpoints supporting multiple AI providers:
 * - OpenAI (GPT models)
 * - Google Gemini
 * - xAI Grok
 * 
 * Supports both streaming and non-streaming responses.
 */

import { conversationStore } from '../lib/conversationStore.js';
import { getOpenAIClient } from '../lib/openaiClient.js';
import { getGeminiClient, GEMINI_SUPPORTED_MODELS } from '../lib/geminiClient.js';
import { getGrokClient, GROK_SUPPORTED_MODELS } from '../lib/grokClient.js';
import OpenAI from 'openai';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

// Get current file directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load system prompt from file
const defaultPromptPath = path.resolve(__dirname, '../prompts/helper-systemprompt.txt');
const SYSTEM_PROMPT_PATH = process.env.SYSTEM_PROMPT_PATH || defaultPromptPath;

let SYSTEM_PROMPT = '';
try {
	SYSTEM_PROMPT = (await readFile(SYSTEM_PROMPT_PATH, 'utf8')).trim();
} catch {
	// System prompt is optional - continue without it
}

/**
 * Determines the provider for a given model
 * @param {string} model - Model name
 * @returns {string} Provider name ('gemini', 'grok', or 'openai')
 */
function getProviderForModel(model) {
	if (GEMINI_SUPPORTED_MODELS.has(model) || model.startsWith('gemini-2.5')) {
		return 'gemini';
	}
	if (GROK_SUPPORTED_MODELS.has(model) || model === 'grok-4') {
		return 'grok';
	}
	return 'openai';
}

/**
 * Prepares messages for API call based on provider
 * @param {Array} history - Conversation history
 * @param {string} provider - Provider name
 * @returns {Array} Formatted messages
 */
function prepareMessages(history, provider) {
	const messages = [];
	
	if (SYSTEM_PROMPT) {
		if (provider === 'gemini') {
			// Gemini uses system instruction separately
			messages.push({ role: 'user', parts: [{ text: SYSTEM_PROMPT }] });
		} else {
			// OpenAI and Grok use system role
			messages.push({ role: 'system', content: SYSTEM_PROMPT });
		}
	}
	
	if (provider === 'gemini') {
		// Gemini uses different format
		messages.push(
			...history
				.filter(m => m.role === 'user' || m.role === 'assistant')
				.map(m => ({
					role: m.role === 'assistant' ? 'model' : 'user',
					parts: [{ text: m.content?.toString() ?? '' }]
				}))
		);
	} else {
		// OpenAI and Grok use standard format
		messages.push(...history.map(m => ({ role: m.role, content: m.content })));
	}
	
	return messages;
}

/**
 * Logs request to provider
 * @param {Object} app - Fastify app instance
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {string} conversationId - Conversation ID
 * @param {Array} messages - Request messages
 * @param {Object} payload - Full request payload
 */
function logProviderRequest(app, provider, model, conversationId, messages, payload) {
	const requestMessages = provider === 'gemini' 
		? messages.map(c => ({ 
			role: c.role === 'model' ? 'assistant' : 'user', 
			content: c?.parts?.[0]?.text ?? '' 
		}))
		: messages;
		
	app.log.info({ 
		event: 'provider_request', 
		provider, 
		model, 
		conversationId, 
		messages: requestMessages, 
		payload 
	}, 'AI provider request');
}

/**
 * Logs response from provider
 * @param {Object} app - Fastify app instance
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {string} conversationId - Conversation ID
 * @param {bigint} startNs - Start time in nanoseconds
 * @param {Object} usage - Token usage
 * @param {string} responseText - Response text
 * @param {Object} reply - Fastify reply object
 */
function logProviderResponse(app, provider, model, conversationId, startNs, usage, responseText, reply) {
	const statusCode = reply?.raw?.statusCode || 200;
	const responseTimeMs = Number(process.hrtime.bigint() - startNs) / 1e6;
	const responsePreview = responseText.slice(0, 200);
	
	app.log.info({ 
		event: 'provider_response', 
		provider, 
		model, 
		conversationId, 
		statusCode, 
		responseTimeMs, 
		usage, 
		responsePreview,
		responseLength: responseText.length 
	}, 'AI provider response');
}

/**
 * Sets up SSE headers for streaming responses
 * @param {Object} reply - Fastify reply object
 */
function setupSSEHeaders(reply) {
	reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
	reply.raw.setHeader('Cache-Control', 'no-cache');
	reply.raw.setHeader('Connection', 'keep-alive');
	reply.raw.setHeader('X-Accel-Buffering', 'no');
	reply.raw.flushHeaders?.();
	try { reply.raw.socket?.setNoDelay?.(true); } catch (_) {}
	// Send a heartbeat to open the stream in some clients/proxies
	try { reply.raw.write(': ping\n\n'); } catch (_) {}
}

/**
 * Creates SSE send function
 * @param {Object} reply - Fastify reply object
 * @returns {Function} Send function for SSE data
 */
function createSSESender(reply) {
	return (payload) => {
		try { 
			reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`); 
		} catch (_) {}
	};
}

/**
 * Creates streaming utilities for word-by-word output
 * @param {Function} send - SSE send function
 * @returns {Object} Streaming utilities
 */
function createStreamingUtils(send) {
	let assistantText = '';
	
	const writeAndFlush = (textChunk) => {
		if (!textChunk) return;
		assistantText += textChunk;
		send({ type: 'token', token: textChunk });
	};

	const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
	
	const flushByWords = async (textChunk, delayMs = 15) => {
		if (!textChunk) return;
		// Emit one word (plus following whitespace) at a time for smoother streaming
		const regex = /\S+\s*/g;
		let match;
		while ((match = regex.exec(textChunk)) !== null) {
			writeAndFlush(match[0]);
			await sleep(delayMs);
		}
	};
	
	return { assistantText: () => assistantText, writeAndFlush, flushByWords };
}

/**
 * Extracts text from various response formats
 * @param {Object} response - API response
 * @param {string} provider - Provider name
 * @returns {string} Extracted text
 */
function extractResponseText(response, provider) {
	if (provider === 'gemini') {
		let text = '';
		if (typeof response?.text === 'function') {
			text = response.text();
		} else {
			text = (response && (response.text || response.outputText || '')) || '';
			if (!text) {
				const firstPart = response?.candidates?.[0]?.content?.parts?.find(
					p => typeof p?.text === 'string' && p.text.length > 0
				);
				text = firstPart?.text || '';
			}
		}
		return text;
	} else if (provider === 'grok') {
		const choice = response?.choices?.[0];
		return choice?.message?.content?.toString() || choice?.text || '';
	} else {
		// OpenAI
		return response.choices?.[0]?.message?.content?.toString() ?? '';
	}
}

/**
 * Extracts usage information from response
 * @param {Object} response - API response
 * @param {string} provider - Provider name
 * @returns {Object} Usage information
 */
function extractUsage(response, provider) {
	if (provider === 'gemini') {
		const um = response?.usageMetadata;
		if (um) {
			return {
				prompt_tokens: um.promptTokenCount || 0,
				completion_tokens: um.candidatesTokenCount || 0,
				total_tokens: um.totalTokenCount || 0
			};
		}
	} else if (provider === 'grok' || provider === 'openai') {
		const u = response?.usage;
		if (u) {
			return {
				prompt_tokens: u.prompt_tokens || 0,
				completion_tokens: u.completion_tokens || 0,
				total_tokens: u.total_tokens || 0
			};
		}
	}
	return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
}

/**
 * Makes a non-streaming API call to any provider
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {Array} messages - Formatted messages
 * @param {Object} app - Fastify app instance
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<Object>} Response with text and usage
 */
async function makeAPICall(provider, model, messages, app, conversationId) {
	logProviderRequest(app, provider, model, conversationId, messages, { model, messages });
	
	if (provider === 'gemini') {
		const gemini = getGeminiClient();
		const payload = { model, contents: messages };
		if (SYSTEM_PROMPT) {
			payload.systemInstruction = SYSTEM_PROMPT;
		}
		const response = await gemini.models.generateContent(payload);
		return {
			text: extractResponseText(response, provider),
			usage: extractUsage(response, provider)
		};
	} else if (provider === 'grok') {
		const grok = getGrokClient();
		const payload = { model: 'grok-4', messages };
		const response = await grok.createChatCompletion(payload);
		return {
			text: extractResponseText(response, provider),
			usage: extractUsage(response, provider)
		};
	} else {
		// OpenAI
		const openai = getOpenAIClient();
		const payload = { model, messages };
		const response = await openai.chat.completions.create(payload);
		return {
			text: extractResponseText(response, provider),
			usage: extractUsage(response, provider)
		};
	}
}

/**
 * Makes a streaming API call to any provider
 * @param {string} provider - Provider name
 * @param {string} model - Model name
 * @param {Array} messages - Formatted messages
 * @param {Object} app - Fastify app instance
 * @param {string} conversationId - Conversation ID
 * @param {Function} writeAndFlush - Function to handle streamed chunks
 * @param {Function} flushByWords - Function to handle word-by-word streaming
 * @returns {Promise<Object>} Usage information
 */
async function makeStreamingAPICall(provider, model, messages, app, conversationId, writeAndFlush, flushByWords) {
	logProviderRequest(app, provider, model, conversationId, messages, { model, messages, stream: true });
	
	if (provider === 'gemini') {
		const gemini = getGeminiClient();
		const payload = { model, contents: messages };
		if (SYSTEM_PROMPT) {
			payload.systemInstruction = SYSTEM_PROMPT;
		}
		
		try {
			const stream = await gemini.models.generateContentStream(payload);
			let chunkCount = 0;
			for await (const chunk of stream) {
				chunkCount++;
				const text = chunk.text ?? '';
				app.log.debug({ text: text.slice(0, 50) + '...' }, 'Gemini chunk received');
				if (text) {
					await flushByWords(text);
				}
			}
			app.log.info({ chunks: chunkCount }, 'Gemini stream completed');
			return extractUsage(stream, provider);
		} catch (streamError) {
			app.log.warn({ error: streamError.message }, 'Gemini streaming failed, falling back to non-stream');
			// Fallback to non-streaming
			const response = await gemini.models.generateContent(payload);
			const text = extractResponseText(response, provider);
			await flushByWords(text);
			return extractUsage(response, provider);
		}
	} else if (provider === 'grok') {
		// xAI Grok: OpenAI-compatible streaming
		const xai = new OpenAI({ 
			apiKey: process.env.XAI_API_KEY || process.env.GROK_API_KEY, 
			baseURL: process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1' 
		});
		const payload = { model: 'grok-4', messages, stream: true };
		const stream = await xai.chat.completions.create(payload);
		for await (const chunk of stream) {
			const delta = chunk?.choices?.[0]?.delta?.content || '';
			if (delta) { 
				writeAndFlush(delta); 
			}
		}
		return extractUsage(stream, provider);
	} else {
		// OpenAI streaming
		const openai = getOpenAIClient();
		const payload = { model, messages, stream: true };
		const stream = await openai.chat.completions.create(payload);
		for await (const part of stream) {
			const delta = part?.choices?.[0]?.delta?.content ?? '';
			writeAndFlush(delta);
		}
		return extractUsage(stream, provider);
	}
}

export default async function chatRoutes(app, _opts) {
	/**
	 * POST /v1/chat
	 * Non-streaming chat completion endpoint
	 */
	app.post('/v1/chat', async (request, reply) => {
		const startNs = process.hrtime.bigint();
		const body = request.body ?? {};
		const inputMessage = (body.message || '').toString();
		let conversationId = body.conversationId || null;
		const model = body.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

		// Input validation
		if (!inputMessage) {
			return reply.code(400).send({ error: 'Missing message' });
		}

		// Create conversation if needed
		if (!conversationId) {
			conversationId = conversationStore.createConversation();
		}

		// Add user message and get history
		conversationStore.appendMessage(conversationId, 'user', inputMessage);
		const history = conversationStore.getMessages(conversationId) || [];

		try {
			// Determine provider and prepare messages
			const provider = getProviderForModel(model);
			const messages = prepareMessages(history, provider);

			// Make API call
			const { text: assistantText, usage } = await makeAPICall(provider, model, messages, app, conversationId);

			// Log response
			logProviderResponse(app, provider, model, conversationId, startNs, usage, assistantText, reply);

			// Save assistant response
			conversationStore.appendMessage(conversationId, 'assistant', assistantText, { model, provider, usage });
			const conversation = conversationStore.getConversation(conversationId);

			reply.type('application/json');
			return {
				conversationId,
				model,
				response: assistantText,
				usage,
				conversation
			};
		} catch (err) {
			return reply.code(500).send({ 
				error: 'Provider error', 
				details: process.env.NODE_ENV === 'development' ? String(err) : undefined 
			});
		}
	});

	/**
	 * POST /v1/chat/refresh  
	 * Regenerates the last assistant response with streaming
	 */
	app.post('/v1/chat/refresh', async (request, reply) => {
		const startNs = process.hrtime.bigint();
		try {
			const body = request.body ?? {};
			const conversationId = body.conversationId;
			const model = (body.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').toString();

			// Input validation
			if (!conversationId) {
				return reply.code(400).send({ error: 'Missing conversationId' });
			}

			// Remove last message if it's assistant
			const history_ = conversationStore.getMessages(conversationId);
			if (history_ && history_.length > 0 && history_[history_.length - 1].role === 'assistant') {
				conversationStore.removeLastMessage(conversationId);
			}

			// Get updated history and validate
			const history = conversationStore.getMessages(conversationId) || [];
			if (history.length === 0 || history[history.length - 1].role !== 'user') {
				return reply.code(400).send({ error: 'No user message to refresh' });
			}

			// Setup streaming
			setupSSEHeaders(reply);
			const send = createSSESender(reply);
			const { assistantText, writeAndFlush, flushByWords } = createStreamingUtils(send);

			// Send init event
			send({ type: 'init', conversationId, model });

			// Determine provider and prepare messages
			const provider = getProviderForModel(model);
			const messages = prepareMessages(history, provider);

			// Stream response
			const usage = await makeStreamingAPICall(provider, model, messages, app, conversationId, writeAndFlush, flushByWords);

			// Finish streaming
			const finalText = assistantText();
			conversationStore.appendMessage(conversationId, 'assistant', finalText, { model, provider, usage });
			const conversation = conversationStore.getConversation(conversationId);
			
			send({ type: 'done', conversationId, model, usage, text: finalText, conversation });
			logProviderResponse(app, provider, model, conversationId, startNs, usage, finalText, reply);
			
			try { reply.raw.end(); } catch (_) {}
		} catch (err) {
			try {
				reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`);
				reply.raw.end();
			} catch (_) {}
		}
	});

	/**
	 * GET /v1/chat/stream
	 * Server-Sent Events streaming chat endpoint
	 * Supports regenerate mode to reuse existing conversation history
	 */
	app.get('/v1/chat/stream', async (request, reply) => {
		const startNs = process.hrtime.bigint();
		try {
			const query = request.query ?? {};
			const inputMessage = (query.message || '').toString();
			let conversationId = query.conversationId || null;
			const model = (query.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').toString();
			const regenerate = query.regenerate === '1' || query.regenerate === 1 || 
							   query.regenerate === true || query.regenerate === 'true';

			// Input validation
			if (!inputMessage) {
				return reply.code(400).send({ error: 'Missing message' });
			}

			// Create conversation if needed
			if (!conversationId) {
				conversationId = conversationStore.createConversation();
			}

			// Add user message only when not regenerating
			if (!regenerate) {
				conversationStore.appendMessage(conversationId, 'user', inputMessage);
			}
			const history = conversationStore.getMessages(conversationId) || [];

			// Setup streaming
			setupSSEHeaders(reply);
			const send = createSSESender(reply);
			const { assistantText, writeAndFlush, flushByWords } = createStreamingUtils(send);

			// Send init event
			send({ type: 'init', conversationId, model });

			// Determine provider and prepare messages
			const provider = getProviderForModel(model);
			const messages = prepareMessages(history, provider);

			// Stream response
			const usage = await makeStreamingAPICall(provider, model, messages, app, conversationId, writeAndFlush, flushByWords);

			// Finish streaming
			const finalText = assistantText();
			conversationStore.appendMessage(conversationId, 'assistant', finalText, { model, provider, usage });
			const conversation = conversationStore.getConversation(conversationId);
			
			send({ type: 'done', conversationId, model, usage, text: finalText, conversation });
			logProviderResponse(app, provider, model, conversationId, startNs, usage, finalText, reply);
			
			try { reply.raw.end(); } catch (_) {}
		} catch (err) {
			try {
				reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`);
				reply.raw.end();
			} catch (_) {}
		}
	});
}
