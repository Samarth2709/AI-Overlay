import { conversationStore } from '../lib/conversationStore.js';
import { getOpenAIClient } from '../lib/openaiClient.js';
import { getGeminiClient, GEMINI_SUPPORTED_MODELS } from '../lib/geminiClient.js';
import { getGrokClient, GROK_SUPPORTED_MODELS } from '../lib/grokClient.js';
import OpenAI from 'openai';
import logger from '../lib/logger.js';
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
	if (!SYSTEM_PROMPT) {
		logger.warn({ SYSTEM_PROMPT_PATH }, '[backend] System prompt file is empty');
	}
} catch (err) {
	logger.warn({ SYSTEM_PROMPT_PATH, err: String(err) }, '[backend] No system prompt found');
}

export default async function chatRoutes(app, _opts) {
	app.post('/v1/chat', async (request, reply) => {
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

				const response = await gemini.models.generateContent(requestPayload);
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

				const completion = await grok.createChatCompletion({
					model: 'grok-4',
					messages: messagesForGrok
				});
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

				const completion = await openai.chat.completions.create({
					model,
					messages: messagesForOpenAI
				});

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
			app.log?.error?.(err);
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
		try {
			const query = request.query ?? {};
			const inputMessage = (query.message || '').toString();
			let conversationId = query.conversationId || null;
			const model = (query.model || process.env.OPENAI_MODEL || 'gpt-4o-mini').toString();

			if (!inputMessage) {
				return reply.code(400).send({ error: 'Missing message' });
			}

			if (!conversationId) {
				conversationId = conversationStore.createConversation();
			}

			conversationStore.appendMessage(conversationId, 'user', inputMessage);
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
				app.log.info({ sse: payload.type }, 'SSE send');
				try { reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (_) {}
			};

			// Send init event with conversationId/model
			send({ type: 'init', conversationId, model });

			let assistantText = '';
			let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

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
					
					app.log.info({ model, systemPrompt: !!SYSTEM_PROMPT }, 'Starting Gemini stream');
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
				const stream = await xai.chat.completions.create({ model: 'grok-4', messages: messagesForGrok, stream: true });
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
				const stream = await openai.chat.completions.create({ model, messages: messagesForOpenAI, stream: true });
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
