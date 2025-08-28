#!/usr/bin/env node
import fetch from 'node-fetch';
import readline from 'node:readline/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';

const args = process.argv.slice(2);
const baseURL = process.env.API_BASE_URL || 'http://127.0.0.1:7071';

// ---------- Supported models (must match backend capabilities) ----------
const OPENAI_SUPPORTED_MODELS = new Set([
	'gpt-4o-mini'
]);
const GEMINI_SUPPORTED_MODELS = new Set([
	'gemini-2.5-pro',
	'gemini-2.5-flash'
]);
const GROK_SUPPORTED_MODELS = new Set(['grok-4']);
const SUPPORTED_MODELS = new Set([
	...OPENAI_SUPPORTED_MODELS,
	...GEMINI_SUPPORTED_MODELS,
	...GROK_SUPPORTED_MODELS
]);

function isSupportedModel(name) {
	return SUPPORTED_MODELS.has((name || '').trim());
}

// ---------- History persistence ----------
const HISTORY_FILE = path.join(os.homedir(), '.ai-assistant-cli-history');
const MAX_HISTORY = 1000;
function loadHistory() {
	try {
		const txt = fs.readFileSync(HISTORY_FILE, 'utf8');
		const lines = txt.split(/\r?\n/).filter(Boolean);
		// readline expects most recent first
		return lines.slice(-MAX_HISTORY).reverse();
	} catch {
		return [];
	}
}
function appendHistory(line) {
	if (!line || !line.trim()) return;
	try {
		fs.appendFileSync(HISTORY_FILE, line + os.EOL, 'utf8');
	} catch {}
}

// ---------- Autocomplete ----------
const COMMANDS = [
	'/help','/new','/use','/id','/list','/get','/del','/model','/models','/refresh','/stream','/stats','/clear','/exit'
];
function completer(line) {
	const trimmed = line.trim();
	if (!trimmed.startsWith('/')) {
		// suggest commands and models for first token
		const suggestions = [...COMMANDS, ...SUPPORTED_MODELS].filter(x => x.startsWith(line));
		return [suggestions.length ? suggestions : [], line];
	}
	const parts = trimmed.split(/\s+/);
	const cmd = parts[0];
	const arg = parts.slice(1).join(' ');
	if (cmd === '/model') {
		const suggestions = [...SUPPORTED_MODELS].filter(m => m.startsWith(arg));
		return [suggestions.map(s => `${cmd} ${s}`), line];
	}
	const suggestions = COMMANDS.filter(c => c.startsWith(trimmed));
	return [suggestions.length ? suggestions : [], line];
}

// ---------- Small UX helpers ----------
function createSpinner(text = '') {
	const frames = ['|','/','-','\\'];
	let i = 0;
	let timer = null;
	const start = () => {
		if (timer) return;
		timer = setInterval(() => {
			output.write(`\r${frames[i++ % frames.length]} ${text}`);
		}, 80);
	};
	const stop = () => {
		if (timer) clearInterval(timer);
		timer = null;
		output.write('\r');
		output.clearLine?.(0);
	};
	return { start, stop };
}

// ---------- HTTP helpers ----------
async function http(method, path_, body, extraHeaders = {}) {
	const headers = { ...extraHeaders };
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	const res = await fetch(`${baseURL}${path_}`, {
		method,
		headers,
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
	if (!res.ok) {
		const text = await res.text().catch(() => '');
		throw new Error(`${method} ${path_} failed ${res.status}: ${text}`);
	}
	return res;
}

// ---------- Backend endpoints ----------
async function createConversation() {
	const res = await http('POST', '/v1/conversations');
	const json = await res.json();
	return json.conversationId;
}

async function getConversation(conversationId) {
	const res = await http('GET', `/v1/conversations/${encodeURIComponent(conversationId)}`);
	return res.json();
}

async function listConversations(limit = 50, offset = 0) {
	const res = await http('GET', `/v1/conversations?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`);
	return res.json();
}

async function deleteConversation(conversationId) {
	const res = await http('DELETE', `/v1/conversations/${encodeURIComponent(conversationId)}`);
	return res.json();
}

async function chat(message, conversationId, model) {
	const res = await http('POST', '/v1/chat', { message, conversationId, model });
	return res.json();
}

// ---------- SSE (Refresh streaming) ----------
async function refreshStream({ conversationId, model, onInit, onToken, onDone, onError }) {
	const res = await http('POST', '/v1/chat/refresh', { conversationId, model }, { 'Accept': 'text/event-stream' });

	const decoder = new TextDecoder();
	let buffer = '';
	let reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;

	const handlePayload = (payload) => {
		try {
			const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
			switch (data?.type) {
				case 'init': onInit && onInit(data); break;
				case 'token': onToken && onToken(data); break;
				case 'done': onDone && onDone(data); break;
				case 'error': onError && onError(data); break;
				default: /* ignore */ break;
			}
		} catch (_) {
			// ignore invalid JSON lines
		}
	};

	function parseBuffer() {
		// Parse Server-Sent Events from buffer
		// Events are separated by blank lines. Fields: event:, data:
		const parts = buffer.split(/\r?\n\r?\n/);
		// Keep the last partial chunk in buffer
		buffer = parts.pop() || '';
		for (const chunk of parts) {
			const dataLines = [];
			const lines = chunk.split(/\r?\n/);
			for (const line of lines) {
				if (!line || line.startsWith(':')) continue; // comment/keep-alive
				if (line.startsWith('data:')) { dataLines.push(line.slice(5).trim()); continue; }
			}
			const dataStr = dataLines.join('\n');
			handlePayload(dataStr);
		}
	}

	if (reader) {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			parseBuffer();
		}
	} else {
		// Fallback for Node streams (node-fetch node stream)
		await new Promise((resolve, reject) => {
			res.body.on('data', (chunk) => {
				buffer += decoder.decode(chunk, { stream: true });
				parseBuffer();
			});
			res.body.on('end', () => resolve());
			res.body.on('error', (err) => reject(err));
		});
	}
}

// Streaming send via GET /v1/chat/stream
async function chatStream({ message, conversationId, model, regenerate, onInit, onToken, onDone, onError }) {
	const params = new URLSearchParams();
	params.set('message', message || '');
	if (conversationId) params.set('conversationId', conversationId);
	if (model) params.set('model', model);
	if (regenerate) params.set('regenerate', '1');
	const res = await http('GET', `/v1/chat/stream?${params.toString()}`, undefined, { 'Accept': 'text/event-stream' });

	const decoder = new TextDecoder();
	let buffer = '';
	let reader = res.body && typeof res.body.getReader === 'function' ? res.body.getReader() : null;

	const handlePayload = (payload) => {
		try {
			const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
			switch (data?.type) {
				case 'init': onInit && onInit(data); break;
				case 'token': onToken && onToken(data); break;
				case 'done': onDone && onDone(data); break;
				case 'error': onError && onError(data); break;
				default: /* ignore */ break;
			}
		} catch (_) {
			// ignore invalid JSON lines
		}
	};

	function parseBuffer() {
		const parts = buffer.split(/\r?\n\r?\n/);
		buffer = parts.pop() || '';
		for (const chunk of parts) {
			const dataLines = [];
			const lines = chunk.split(/\r?\n/);
			for (const line of lines) {
				if (!line || line.startsWith(':')) continue;
				if (line.startsWith('data:')) { dataLines.push(line.slice(5).trim()); continue; }
			}
			handlePayload(dataLines.join('\n'));
		}
	}

	if (reader) {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			parseBuffer();
		}
	} else {
		await new Promise((resolve, reject) => {
			res.body.on('data', (chunk) => {
				buffer += decoder.decode(chunk, { stream: true });
				parseBuffer();
			});
			res.body.on('end', () => resolve());
			res.body.on('error', (err) => reject(err));
		});
	}
}

// ---------- One-shot mode ----------
async function oneShot(message, conversationId, model) {
	const trimmed = (message || '').trim();
	if (trimmed.startsWith('/')) {
		console.error('Commands are not supported in one-shot mode. Run without args and type commands interactively.');
		process.exitCode = 1;
		return;
	}
	if (model && !isSupportedModel(model)) {
		console.error(`Unsupported model: ${model}. Use /models to list supported.`);
		process.exitCode = 1;
		return;
	}
	const spin = createSpinner('thinking...');
	spin.start();
	try {
		const json = await chat(message, conversationId, model);
		spin.stop();
		console.log(`[conversationId] ${json.conversationId}`);
		console.log(json.response);
	} catch (err) {
		spin.stop();
		throw err;
	}
}

// ---------- Interactive CLI ----------
async function interactive() {
	let conversationId = process.env.CONVERSATION_ID || null;
	let currentModel = process.env.MODEL || null;
	if (currentModel && !isSupportedModel(currentModel)) currentModel = null;

	const rl = readline.createInterface({ 
		input, 
		output, 
		terminal: true,
		history: loadHistory(),
		historySize: MAX_HISTORY,
		completer
	});

	// Graceful Ctrl+C
	const onSigint = () => {
		output.write('\n');
		rl.close();
	};
	process.once('SIGINT', onSigint);

	const help = () => {
		console.log('AI Assistant CLI');
		console.log('- Type your message and press Enter');
		console.log('- Use Up/Down to navigate history (persisted across sessions).');
		console.log('- Commands:');
		console.log('  /help                   Show this help');
		console.log('  /new                    Create a new conversation');
		console.log('  /use <id>               Switch to a conversation');
		console.log('  /id                     Show current conversation id');
		console.log('  /list [limit] [offset]  List conversations');
		console.log('  /get [id]               Show conversation summary (default: current)');
		console.log('  /del [id|current]       Delete a conversation');
		console.log('  /model [name|clear]     Set or clear model for requests');
		console.log('  /models                 List supported model names');
		console.log('  /refresh                Refresh last AI response (SSE streaming)');
		console.log('  /retry                  Alias for /refresh');
		console.log('  /stream <message>       Stream a message (GET /v1/chat/stream)');
		console.log('  /save [file]            Save current conversation to a file');
		console.log('  /stats                  Show DB stats');
		console.log('  /clear                  Clear the screen');
		console.log('  /exit                   Quit');
		console.log('');
	};

	help();
	try {
		for (;;) {
			const promptId = conversationId ? `[${conversationId}]` : '';
			const promptModel = currentModel ? `@${currentModel}` : '';
			const q = `you ${promptId}${promptModel}> `;
			const line = (await rl.question(q)).trim();
			if (!line) continue;

			appendHistory(line);

			if (line === '/exit') break;
			if (line === '/help') { help(); continue; }
			if (line === '/clear') { console.clear(); continue; }

			if (line === '/models') {
				console.log('Supported models:');
				console.log(`- openai: ${[...OPENAI_SUPPORTED_MODELS].join(', ')}`);
				console.log(`- gemini: ${[...GEMINI_SUPPORTED_MODELS].join(', ')}`);
				console.log(`- grok:   ${[...GROK_SUPPORTED_MODELS].join(', ')}`);
				continue;
			}

			if (line === '/new') {
				try {
					conversationId = await createConversation();
					console.log(`(new conversation) ${conversationId}`);
				} catch (err) {
					console.error(String(err));
				}
				continue;
			}

			if (line.startsWith('/use ')) {
				conversationId = line.slice(5).trim() || null;
				console.log(conversationId ? `(using ${conversationId})` : '(no conversation)');
				continue;
			}

			if (line === '/use') {
				console.log('usage: /use <conversationId>');
				continue;
			}

			if (line === '/id') {
				console.log(conversationId ? conversationId : '(no conversation)');
				continue;
			}

			if (line.startsWith('/list')) {
				const parts = line.split(/\s+/);
				const limit = Number(parts[1] || 50);
				const offset = Number(parts[2] || 0);
				try {
					const spin = createSpinner('loading conversations...');
					spin.start();
					const json = await listConversations(limit, offset);
					spin.stop();
					console.log(`conversations (limit=${json.pagination?.limit}, offset=${json.pagination?.offset})`);
					for (const c of json.conversations || []) {
						const updated = c.updated_at ? new Date(c.updated_at).toISOString() : '';
						console.log(`- ${c.id}  [${updated}]  ${c.title || ''}`);
					}
					if (json.stats) {
						console.log(`stats: conversations=${json.stats.conversations}, messages=${json.stats.messages}, dbSize=${json.stats.databaseSize}`);
					}
				} catch (err) {
					console.error(String(err));
				}
				continue;
			}

			if (line === '/stats') {
				try {
					const spin = createSpinner('stats...');
					spin.start();
					const json = await listConversations(1, 0);
					spin.stop();
					if (json.stats) {
						console.log(`stats: conversations=${json.stats.conversations}, messages=${json.stats.messages}, dbSize=${json.stats.databaseSize}`);
					} else {
						console.log('no stats available');
					}
				} catch (err) {
					console.error(String(err));
				}
				continue;
			}

			if (line.startsWith('/get')) {
				const id = line.replace('/get', '').trim() || conversationId;
				if (!id) { console.log('no conversation selected'); continue; }
				try {
					const spin = createSpinner('loading conversation...');
					spin.start();
					const json = await getConversation(id);
					spin.stop();
					const conv = json.conversation || {};
					console.log(`[conversationId] ${json.conversationId || id}`);
					console.log(`createdAt=${new Date(conv.createdAt || 0).toISOString()}`);
					console.log(`updatedAt=${new Date(conv.updatedAt || 0).toISOString()}`);
					console.log(`messages=${(conv.chatHistory || []).length}`);
					const last = (conv.chatHistory || []).slice(-3);
					for (const m of last) {
						console.log(`${m.role}> ${truncate(m.content, 160)}`);
					}
				} catch (err) {
					console.error(String(err));
				}
				continue;
			}

			if (line.startsWith('/del')) {
				const idArg = line.replace('/del', '').trim();
				const id = idArg === 'current' || !idArg ? conversationId : idArg;
				if (!id) { console.log('no conversation selected'); continue; }
				try {
					const spin = createSpinner('deleting...');
					spin.start();
					const json = await deleteConversation(id);
					spin.stop();
					console.log(`deleted: ${json.deleted ? 'yes' : 'no'} (${json.conversationId || id})`);
					if (conversationId === id) conversationId = null;
				} catch (err) {
					console.error(String(err));
				}
				continue;
			}

			if (line === '/model' || line.startsWith('/model ')) {
				const name = line.replace('/model', '').trim();
				if (!name) {
					console.log(currentModel ? `model=${currentModel}` : 'model not set');
				} else if (name === 'clear' || name === 'default') {
					currentModel = null;
					console.log('model cleared');
				} else if (!isSupportedModel(name)) {
					console.log(`unsupported model: ${name}`);
					console.log('use /models to list supported names');
				} else {
					currentModel = name;
					console.log(`model set to ${currentModel}`);
				}
				continue;
			}

			if (line === '/refresh' || line === '/retry') {
				if (!conversationId) { console.log('no conversation selected'); continue; }
				try {
					let printedAny = false;
					await refreshStream({
						conversationId,
						model: currentModel || undefined,
						onInit: (data) => {
							console.log(`refreshing [${data?.conversationId || conversationId}] model=${data?.model || currentModel || 'default'}`);
						},
						onToken: (data) => {
							if (!data || typeof data.token !== 'string') return;
							printedAny = true;
							output.write(data.token);
						},
						onDone: (data) => {
							if (data?.conversationId) conversationId = data.conversationId;
							if (printedAny) output.write('\n');
							console.log('(refresh done)');
						},
						onError: (data) => {
							if (printedAny) output.write('\n');
							console.error('refresh error:', typeof data === 'string' ? data : JSON.stringify(data));
						}
					});
				} catch (err) {
					console.error(String(err));
				}
				continue;
			}

			if (line.startsWith('/stream ')) {
				const msg = line.slice(8).trim();
				if (!msg) { console.log('usage: /stream <message>'); continue; }
				try {
					let printedAny = false;
					await chatStream({
						message: msg,
						conversationId,
						model: currentModel || undefined,
						regenerate: false,
						onInit: (data) => {
							console.log(`streaming [${data?.conversationId || conversationId || '(new)'}] model=${data?.model || currentModel || 'default'}`);
						},
						onToken: (data) => {
							if (!data || typeof data.token !== 'string') return;
							printedAny = true;
							output.write(data.token);
						},
						onDone: (data) => {
							if (data?.conversationId) conversationId = data.conversationId;
							if (printedAny) output.write('\n');
							console.log('(stream done)');
						},
						onError: (data) => {
							if (printedAny) output.write('\n');
							console.error('stream error:', typeof data === 'string' ? data : JSON.stringify(data));
						}
					});
				} catch (err) {
					console.error(String(err));
				}
				continue;
			}

			if (line.startsWith('/save')) {
				const arg = line.replace('/save', '').trim();
				if (!conversationId) { console.log('no conversation selected'); continue; }
				try {
					const json = await getConversation(conversationId);
					const conv = json.conversation || {};
					const fname = arg || `conversation_${conversationId}.txt`;
					const out = [];
					out.push(`# conversation ${conversationId}`);
					out.push(`createdAt: ${new Date(conv.createdAt || 0).toISOString()}`);
					out.push(`updatedAt: ${new Date(conv.updatedAt || 0).toISOString()}`);
					out.push('');
					for (const m of conv.chatHistory || []) {
						out.push(`${m.role}> ${m.content || ''}`);
					}
					fs.writeFileSync(fname, out.join('\n'), 'utf8');
					console.log(`saved to ${fname}`);
				} catch (err) {
					console.error(String(err));
				}
				continue;
			}

			// Handle unknown slash commands explicitly
			if (line.startsWith('/')) {
				console.log('unknown command. type /help for a list of commands.');
				continue;
			}

			// default: send message (non-stream)
			try {
				const spin = createSpinner('thinking...');
				spin.start();
				const json = await chat(line, conversationId, currentModel || undefined);
				spin.stop();
				conversationId = json.conversationId;
				console.log(`assistant> ${json.response}\n`);
			} catch (err) {
				console.error(String(err));
			}
		}
	} finally {
		rl.close();
		process.off('SIGINT', onSigint);
	}
}

function truncate(s, max) {
	if (!s || s.length <= max) return s || '';
	return s.slice(0, max - 1) + '…';
}

(async () => {
	if (args.length > 0) {
		const message = args.join(' ');
		await oneShot(message, process.env.CONVERSATION_ID || null, process.env.MODEL || null);
		return;
	}
	await interactive();
})();
