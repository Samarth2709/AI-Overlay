#!/usr/bin/env node
import fetch from 'node-fetch';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const args = process.argv.slice(2);
const baseURL = process.env.API_BASE_URL || 'http://127.0.0.1:7071';

async function sendMessage(message, conversationId) {
	const res = await fetch(`${baseURL}/v1/chat`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ message, conversationId })
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Request failed ${res.status}: ${text}`);
	}
	return res.json();
}

async function oneShot(message, conversationId) {
	const json = await sendMessage(message, conversationId);
	console.log(`[conversationId] ${json.conversationId}`);
	console.log(json.response);
}

async function interactive() {
	let conversationId = process.env.CONVERSATION_ID || null;
	const rl = readline.createInterface({ input, output });
	console.log('AI Assistant CLI');
	console.log('- Type your message and press Enter');
	console.log("- Commands: /new to start a new chat, /exit to quit\n");
	try {
		for (;;) {
			const q = conversationId ? `you [${conversationId}]> ` : 'you> ';
			const line = (await rl.question(q)).trim();
			if (!line) continue;
			if (line === '/exit') break;
			if (line === '/new') { conversationId = null; console.log('(new conversation)'); continue; }
			try {
				const json = await sendMessage(line, conversationId);
				conversationId = json.conversationId;
				console.log(`assistant> ${json.response}\n`);
			} catch (err) {
				console.error(String(err));
			}
		}
	} finally {
		rl.close();
	}
}

(async () => {
	if (args.length > 0) {
		const message = args.join(' ');
		await oneShot(message, process.env.CONVERSATION_ID || null);
		return;
	}
	await interactive();
})();
