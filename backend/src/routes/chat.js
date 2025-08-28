import { conversationStore } from '../lib/conversationStore.js';
import { getOpenAIClient } from '../lib/openaiClient.js';
import { getGeminiClient, GEMINI_SUPPORTED_MODELS } from '../lib/geminiClient.js';
import { getGrokClient, GROK_SUPPORTED_MODELS } from '../lib/grokClient.js';
import OpenAI from 'openai';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultPromptPath = path.resolve(__dirname, '../prompts/helper-systemprompt.txt');
const SYSTEM_PROMPT_PATH = process.env.SYSTEM_PROMPT_PATH || defaultPromptPath;

let SYSTEM_PROMPT = '';
try {
	SYSTEM_PROMPT = (await readFile(SYSTEM_PROMPT_PATH, 'utf8')).trim();
} catch {}

export default async function chatRoutes(app, _opts) {
	app.post('/v1/chat', async (request, reply) => {
        const __startNs = process.hrtime.bigint();
		const body = request.body ?? {};
		const inputMessage = (body.message || '').toString();
		let conversationId = body.conversationId || null;
		const model = body.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

		if (!inputMessage) {
			return reply.code(400).send({ error: 'Missing message' });
		}

		if (!conversationId) {
			conversationId = conversationStore.createConversation();
		}

		conversationStore.appendMessage(conversationId, 'user', inputMessage);
		const history = conversationStore.getMessages(conversationId) || [];

		let assistantText = '';
		let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

		try {
			if (GEMINI_SUPPORTED_MODELS.has(model) || model.startsWith('gemini-2.5')) {
				const gemini = getGeminiClient();
				// Map our conversation history to Gemini's contents format
				const contents = [];
				if (SYSTEM_PROMPT) {
					// Prepend system prompt as contextual content to reinforce adherence
					contents.push({ role: 'user', parts: [{ text: SYSTEM_PROMPT }] });
				}
				contents.push(
					...history
						.filter(m => m.role === 'user' || m.role === 'assistant')
						.map(m => ({
							role: m.role === 'assistant' ? 'model' : 'user',
							parts: [{ text: m.content?.toString() ?? '' }]
						}))
				);

				const requestPayload = {
					model,
					contents
				};
				if (SYSTEM_PROMPT) {
					// Provide dedicated system instruction for Gemini as a simple string
					requestPayload.systemInstruction = SYSTEM_PROMPT;
				}
				// Standardized: request log
				const requestMessages = contents.map(c => ({ role: c.role === 'model' ? 'assistant' : 'user', content: c?.parts?.[0]?.text ?? '' }));
				app.log.info({ event: 'provider_request', provider: 'gemini', model, conversationId, messages: requestMessages, payload: requestPayload }, 'AI provider request');

				const response = await gemini.models.generateContent(requestPayload);
				// Standardized: response log (with status and timing)
				{
					const statusCode = reply?.raw?.statusCode || 200;
					const responseTimeMs = Number(process.hrtime.bigint() - __startNs) / 1e6;
					app.log.info({ event: 'provider_response', provider: 'gemini', model, conversationId, statusCode, responseTimeMs, usage: response?.usageMetadata ?? {}, responsePreview: (response?.text || response?.outputText || '').slice(0, 200) }, 'AI provider response');
				}
				assistantText = (response && (response.text || response.outputText || '')) || '';
				if (!assistantText) {
					const firstPart = response?.candidates?.[0]?.content?.parts?.find(p => typeof p?.text === 'string' && p.text.length > 0);
					assistantText = firstPart?.text || '';
				}
				// Map Gemini usage metadata to our usage shape
				const um = response?.usageMetadata;
				if (um) {
					usage = {
						prompt_tokens: um.promptTokenCount || 0,
						completion_tokens: um.candidatesTokenCount || 0,
						total_tokens: um.totalTokenCount || 0
					};
				}
			} else if (GROK_SUPPORTED_MODELS.has(model) || model === 'grok-4') {
				const grok = getGrokClient();
				const messagesForGrok = [];
				if (SYSTEM_PROMPT) {
					messagesForGrok.push({ role: 'system', content: SYSTEM_PROMPT });
				}
				messagesForGrok.push(...history.map(m => ({ role: m.role, content: m.content })));

				const grokBody = { model: 'grok-4', messages: messagesForGrok };
				// Standardized: request log
				app.log.info({ event: 'provider_request', provider: 'grok', model: 'grok-4', conversationId, messages: messagesForGrok, payload: grokBody }, 'AI provider request');
				const completion = await grok.createChatCompletion(grokBody);
				// Standardized: response log (with status and timing)
				{
					const statusCode = reply?.raw?.statusCode || 200;
					const responseTimeMs = Number(process.hrtime.bigint() - __startNs) / 1e6;
					app.log.info({ event: 'provider_response', provider: 'grok', model: 'grok-4', conversationId, statusCode, responseTimeMs, usage: completion?.usage ?? {}, responsePreview: (completion?.choices?.[0]?.message?.content || completion?.choices?.[0]?.text || '').slice(0, 200) }, 'AI provider response');
				}
				const choice = completion?.choices?.[0];
				assistantText = choice?.message?.content?.toString() || choice?.text || '';
				// xAI usage fields may differ; leave usage as zeros unless present
				if (completion?.usage) {
					usage = {
						prompt_tokens: completion.usage.prompt_tokens || 0,
						completion_tokens: completion.usage.completion_tokens || 0,
						total_tokens: completion.usage.total_tokens || 0
					};
				}
			} else {
				const openai = getOpenAIClient();
				const messagesForOpenAI = [];
				if (SYSTEM_PROMPT) {
					messagesForOpenAI.push({ role: 'system', content: SYSTEM_PROMPT });
				}
				messagesForOpenAI.push(...history.map(m => ({ role: m.role, content: m.content })));

				const openaiBody = { model, messages: messagesForOpenAI };
				// Standardized: request log
				app.log.info({ event: 'provider_request', provider: 'openai', model, conversationId, messages: messagesForOpenAI, payload: openaiBody }, 'AI provider request');
				const completion = await openai.chat.completions.create(openaiBody);
				// Standardized: response log (with status and timing)
				{
					const statusCode = reply?.raw?.statusCode || 200;
					const responseTimeMs = Number(process.hrtime.bigint() - __startNs) / 1e6;
					app.log.info({ event: 'provider_response', provider: 'openai', model, conversationId, statusCode, responseTimeMs, usage: completion?.usage ?? {}, responsePreview: (completion?.choices?.[0]?.message?.content || '').slice(0, 200) }, 'AI provider response');
				}

				assistantText = completion.choices?.[0]?.message?.content?.toString() ?? '';
				const u = completion.usage;
				if (u) {
					usage = {
						prompt_tokens: u.prompt_tokens || 0,
						completion_tokens: u.completion_tokens || 0,
						total_tokens: u.total_tokens || 0
					};
				}
			}
		} catch (err) {
			return reply.code(500).send({ error: 'Provider error', details: process.env.NODE_ENV === 'development' ? String(err) : undefined });
		}

		conversationStore.appendMessage(conversationId, 'assistant', assistantText);

		reply.type('application/json');
		return {
			conversationId,
			model,
			response: assistantText,
			usage
		};
	});

	// Server-Sent Events streaming endpoint
	app.get('/v1/chat/stream', async (request, reply) => {
        const __startNs = process.hrtime.bigint();
		try {
			const query = request.query ?? {};
			const inputMessage = (query.message || '').toString();
			let conversationId = query.conversationId || null;
			const model = (query.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').toString();
			const regenerate = query.regenerate === '1' || query.regenerate === 1 || query.regenerate === true || query.regenerate === 'true';

			if (!inputMessage) {
				return reply.code(400).send({ error: 'Missing message' });
			}

			if (!conversationId) {
				conversationId = conversationStore.createConversation();
			}

			// Only append the user message when not regenerating. Regenerate reuses history.
			if (!regenerate) {
				conversationStore.appendMessage(conversationId, 'user', inputMessage);
			}
			const history = conversationStore.getMessages(conversationId) || [];

			// Prepare SSE headers (ensure immediate flushes)
			reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
			reply.raw.setHeader('Cache-Control', 'no-cache');
			reply.raw.setHeader('Connection', 'keep-alive');
			reply.raw.setHeader('X-Accel-Buffering', 'no');
			reply.raw.flushHeaders?.();
			try { reply.raw.socket?.setNoDelay?.(true); } catch (_) {}
			// Send a heartbeat to open the stream in some clients/proxies
			try { reply.raw.write(': ping\n\n'); } catch (_) {}

			const send = (payload) => {
				try { reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (_) {}
			};

			// Send init event with conversationId/model
			send({ type: 'init', conversationId, model });

			let assistantText = '';
			let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
			let currentProvider = 'unknown';

			const writeAndFlush = (textChunk) => {
				if (!textChunk) return;
				assistantText += textChunk;
				send({ type: 'token', token: textChunk });
			};

			const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
			const flushByWords = async (textChunk, delayMs = 15) => {
				if (!textChunk) return;
				// Emit one word (plus following whitespace) at a time for a smoother streaming effect
				const regex = /\S+\s*/g;
				let match;
				while ((match = regex.exec(textChunk)) !== null) {
					writeAndFlush(match[0]);
					// very minor delay between words
					// eslint-disable-next-line no-await-in-loop
					await sleep(delayMs);
				}
			};

			const finish = () => {
				conversationStore.appendMessage(conversationId, 'assistant', assistantText);
				send({ type: 'done', conversationId, model, usage, text: assistantText });
				// Standardized: response log (with status and timing)
				{
					const statusCode = reply?.raw?.statusCode || 200;
					const responseTimeMs = Number(process.hrtime.bigint() - __startNs) / 1e6;
					app.log.info({ event: 'provider_response', provider: currentProvider, model, conversationId, statusCode, responseTimeMs, usage, responsePreview: assistantText.slice(0, 200), responseLength: assistantText.length }, 'AI provider response');
				}
				try { reply.raw.end(); } catch (_) {}
			};

			// Stream from providers
			if (GEMINI_SUPPORTED_MODELS.has(model) || model.startsWith('gemini-2.5')) {
				const gemini = getGeminiClient();
				const contents = [];
				// Build contents from conversation history
				contents.push(
					...history
						.filter(m => m.role === 'user' || m.role === 'assistant')
						.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content?.toString() ?? '' }] }))
				);

				try {
					// Use the streaming API as shown in the tutorial
					const streamPayload = {
						model,
						contents,
						...(SYSTEM_PROMPT ? { config: { systemInstruction: SYSTEM_PROMPT } } : {})
					};
					// Standardized: request log
					const requestMessages = contents.map(c => ({ role: c.role === 'model' ? 'assistant' : 'user', content: c?.parts?.[0]?.text ?? '' }));
					app.log.info({ event: 'provider_request', provider: 'gemini', model, conversationId, messages: requestMessages, payload: streamPayload }, 'AI provider request');
					currentProvider = 'gemini';
					const stream = await gemini.models.generateContentStream(streamPayload);
					
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
					
					// Try to get usage data from the stream result
					const um = stream?.usageMetadata;
					if (um) {
						usage = {
							prompt_tokens: um.promptTokenCount || 0,
							completion_tokens: um.candidatesTokenCount || 0,
							total_tokens: um.totalTokenCount || 0
						};
					}
					finish();
				} catch (streamError) {
					app.log.warn({ error: streamError.message }, 'Gemini streaming failed, falling back to non-stream');
					// Fallback to non-streaming
					const response = await gemini.models.generateContent({
						model,
						contents,
						...(SYSTEM_PROMPT ? { config: { systemInstruction: SYSTEM_PROMPT } } : {})
					});
					
					let text = '';
					if (typeof response?.text === 'function') {
						text = response.text();
					} else {
						text = (response && (response.text || response.outputText || '')) || '';
						if (!text) {
							const firstPart = response?.candidates?.[0]?.content?.parts?.find(p => typeof p?.text === 'string' && p.text.length > 0);
							text = firstPart?.text || '';
						}
					}
					await flushByWords(text);
					
					const um = response?.usageMetadata;
					if (um) {
						usage = {
							prompt_tokens: um.promptTokenCount || 0,
							completion_tokens: um.candidatesTokenCount || 0,
							total_tokens: um.totalTokenCount || 0
						};
					}
					finish();
				}
			} else if (GROK_SUPPORTED_MODELS.has(model) || model === 'grok-4') {
				// xAI Grok: OpenAI-compatible streaming via SSE
				const xai = new OpenAI({ apiKey: process.env.XAI_API_KEY || process.env.GROK_API_KEY, baseURL: process.env.XAI_API_BASE_URL || 'https://api.x.ai/v1' });
				const messagesForGrok = [];
				if (SYSTEM_PROMPT) { messagesForGrok.push({ role: 'system', content: SYSTEM_PROMPT }); }
				messagesForGrok.push(...history.map(m => ({ role: m.role, content: m.content })));
				const grokBody = { model: 'grok-4', messages: messagesForGrok, stream: true };
				// Standardized: request log
				app.log.info({ event: 'provider_request', provider: 'grok', model: 'grok-4', conversationId, messages: messagesForGrok, payload: grokBody }, 'AI provider request');
				currentProvider = 'grok';
				const stream = await xai.chat.completions.create(grokBody);
				for await (const chunk of stream) {
					const delta = chunk?.choices?.[0]?.delta?.content || '';
					if (delta) { writeAndFlush(delta); }
				}
				const u = stream?.usage;
				if (u) {
					usage = {
						prompt_tokens: u.prompt_tokens || 0,
						completion_tokens: u.completion_tokens || 0,
						total_tokens: u.total_tokens || 0
					};
				}
				finish();
			} else {
				// OpenAI streaming
				const openai = getOpenAIClient();
				const messagesForOpenAI = [];
				if (SYSTEM_PROMPT) { messagesForOpenAI.push({ role: 'system', content: SYSTEM_PROMPT }); }
				messagesForOpenAI.push(...history.map(m => ({ role: m.role, content: m.content })));
				const openaiBody = { model, messages: messagesForOpenAI, stream: true };
				// Standardized: request log
				app.log.info({ event: 'provider_request', provider: 'openai', model, conversationId, messages: messagesForOpenAI, payload: openaiBody }, 'AI provider request');
				currentProvider = 'openai';
				const stream = await openai.chat.completions.create(openaiBody);
				for await (const part of stream) {
					const delta = part?.choices?.[0]?.delta?.content ?? '';
					writeAndFlush(delta);
				}
				const u = stream?.usage;
				if (u) {
					usage = {
						prompt_tokens: u.prompt_tokens || 0,
						completion_tokens: u.completion_tokens || 0,
						total_tokens: u.total_tokens || 0
					};
				}
				finish();
			}
		} catch (err) {
			try {
				reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`);
				reply.raw.end();
			} catch (_) {}
		}
	});
}
