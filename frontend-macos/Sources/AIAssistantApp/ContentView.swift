import SwiftUI
import AppKit

struct Model: Identifiable, Codable {
	let id: String
	let name: String
	let description: String
}

struct ModelsResponse: Codable {
	let models: [Model]
	let `default`: String
}

struct Message: Identifiable, Equatable {
	let id = UUID()
	let role: String
	let content: String

	static func == (lhs: Message, rhs: Message) -> Bool {
		lhs.id == rhs.id && lhs.role == rhs.role && lhs.content == rhs.content
	}
}

struct TypingDots: View {
	@State private var animate = false
	var body: some View {
		HStack(spacing: 6) {
			ForEach(0..<3) { index in
				Circle()
					.fill(Color.white)
					.frame(width: 8, height: 8)
					.scaleEffect(animate ? 1.0 : 0.6)
					.offset(y: animate ? -2 : 2)
					.animation(.easeInOut(duration: 0.35).repeatForever().delay(Double(index) * 0.10), value: animate)
			}
		}
		.onAppear { animate = true }
		.accessibilityLabel("Assistant is typing")
	}
}

struct ChatBubble: View {
	let message: Message
	var isTyping: Bool = false
	var onCopy: (() -> Void)? = nil
	var onRedo: (() -> Void)? = nil
	var body: some View {
		HStack(alignment: .top) {
			if message.role == "assistant" {
				VStack(alignment: .leading, spacing: 10) {
					Group {
						if isTyping && message.content.isEmpty {
							TypingDots()
								.frame(maxWidth: .infinity, alignment: .leading)
						} else {
							Text(message.content)
								.font(.custom("Montserrat", size: 15).weight(.light))
								.frame(maxWidth: .infinity, alignment: .leading)
						}
					}
					if !isTyping && !message.content.isEmpty {
						HStack(spacing: 14) {
							Button(action: { onCopy?() }) { Image(systemName: "doc.on.doc") }
								.buttonStyle(.plain)
								.opacity(0.7)
							Button(action: { onRedo?() }) { Image(systemName: "arrow.clockwise") }
								.buttonStyle(.plain)
								.opacity(0.7)
						}
						.font(.system(size: 12))
						.foregroundColor(.secondary)
					}
				}
				.padding(16)
				.background(.ultraThinMaterial)
				.cornerRadius(14)
				.frame(maxWidth: .infinity, alignment: .leading)
			} else {
				Spacer(minLength: 40)
				Text(message.content)
					.font(.custom("Montserrat", size: 14).weight(.medium))
					.padding(.vertical, 10)
					.padding(.horizontal, 14)
					.background(Color.gray.opacity(0.25))
					.cornerRadius(16)
					.frame(maxWidth: 380, alignment: .trailing)
			}
		}
	}
}

struct ContentView: View {
	@State private var messages: [Message] = []
	@State private var input: String = ""
	@State private var isSending: Bool = false
	@State private var conversationId: String? = nil

	@State private var availableModels: [Model] = []
	@State private var selectedModel: Model?
	@State private var isLoadingModels: Bool = true
	@FocusState private var isInputFocused: Bool

	private let apiBaseURL = URL(string: "http://127.0.0.1:7071")!

	var body: some View {
		VStack(spacing: 10) {
			// Header – full-width bar with bottom divider
			HStack(spacing: 8) {
				Text("AI Assistant")
					.font(.custom("Montserrat", size: 13).weight(.medium))
					.foregroundColor(.secondary)
				Spacer()
				Menu {
					if isLoadingModels {
						Text("Loading models...")
							.foregroundColor(.secondary)
					} else {
						ForEach(availableModels) { model in
							Button(action: { selectedModel = model }) {
								VStack(alignment: .leading, spacing: 2) {
									Text(model.name)
										.font(.custom("Montserrat", size: 11).weight(.regular))
									Text(model.description)
										.font(.custom("Montserrat", size: 10).weight(.light))
										.foregroundColor(.secondary)
								}
							}
						}
					}
				} label: {
					HStack(spacing: 4) {
						if isLoadingModels {
							Text("Loading...")
						} else {
							Text(selectedModel?.name ?? "Select Model")
						}
						Image(systemName: "chevron.down")
					}
				}
				.buttonStyle(.borderless)
				.disabled(isLoadingModels)
				Button("New Chat") { startNewChat() }
					.buttonStyle(.bordered)
			}
			.frame(maxWidth: .infinity)
			.padding(.vertical, 6)
			.overlay(alignment: .bottom) {
				Rectangle()
					.fill(Color.white.opacity(0.08))
					.frame(height: 1)
			}

			ScrollViewReader { proxy in
				ScrollView {
					LazyVStack(alignment: .leading, spacing: 14) {
						ForEach(messages) { msg in
							ChatBubble(
								message: msg,
								isTyping: isSending && msg.role == "assistant" && msg.content.isEmpty,
								onCopy: { copyMessage(msg) },
								onRedo: { redoAssistantMessage(msg) }
							)
							.id(msg.id)
						}
					}
					.padding(.vertical, 6)
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.onChange(of: messages) { _ in
					if let lastId = messages.last?.id {
						withAnimation { proxy.scrollTo(lastId, anchor: .bottom) }
					}
				}
			}

			// Footer input
			HStack(spacing: 10) {
				HStack(spacing: 8) {
					Image(systemName: "sparkles")
						.foregroundColor(.secondary)
					TextField("Ask anything", text: $input)
						.textFieldStyle(.plain)
						.font(.custom("Montserrat", size: 12).weight(.medium))
						.focused($isInputFocused)
				}
				.padding(.horizontal, 12)
				.frame(height: 36)
				.background(.thinMaterial)
				.cornerRadius(12)
				.overlay(
					RoundedRectangle(cornerRadius: 12)
						.stroke(Color.white.opacity(0.06), lineWidth: 1)
				)
				.onSubmit { send() }

				Button(action: send) {
					Text("Send")
						.font(.custom("Montserrat", size: 12).weight(.medium))
				}
				.buttonStyle(.borderedProminent)
			}
		}
		.padding(14)
		.frame(minWidth: 420, minHeight: 480)
		.onAppear {
			loadAvailableModels()
			// Focus the input field when the view appears
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
				isInputFocused = true
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
			// Focus the input field when the app becomes active
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
				isInputFocused = true
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .focusInput)) { _ in
			// Focus when hotkey shows overlay
			DispatchQueue.main.async {
				isInputFocused = true
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .startNewChat)) { _ in
			startNewChat()
		}
	}

	private func startNewChat() {
		messages.removeAll()
		conversationId = nil
	}

	private func send() {
		let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !text.isEmpty else { return }
		messages.append(Message(role: "user", content: text))
		input = ""
		isSending = true

		Task { await streamBackend(message: text, conversationId: conversationId, model: selectedModel?.id, regenerate: false) }
	}

	private func callBackend(message: String, conversationId: String?, model: String?) async -> String? {
		let url = apiBaseURL.appendingPathComponent("/v1/chat")
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		var body: [String: Any] = ["message": message]
		if let conversationId { body["conversationId"] = conversationId }
		if let model { body["model"] = model }
		request.httpBody = try? JSONSerialization.data(withJSONObject: body)

		do {
			let (data, response) = try await URLSession.shared.data(for: request)
			guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
			if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
				if let cid = json["conversationId"] as? String {
					self.conversationId = cid
				}
				return json["response"] as? String
			}
		} catch {
			return nil
		}
		return nil
	}

	private func streamBackend(message: String, conversationId: String?, model: String?, replaceAssistantAt indexToReplace: Int? = nil, regenerate: Bool = false) async {
		var components = URLComponents(url: apiBaseURL.appendingPathComponent("/v1/chat/stream"), resolvingAgainstBaseURL: false)!
		var items: [URLQueryItem] = [URLQueryItem(name: "message", value: message)]
		if let conversationId { items.append(URLQueryItem(name: "conversationId", value: conversationId)) }
		if let model { items.append(URLQueryItem(name: "model", value: model)) }
		if regenerate { items.append(URLQueryItem(name: "regenerate", value: "1")) }
		components.queryItems = items
		guard let url = components.url else { await MainActor.run { isSending = false }; return }
		do {
			let (bytes, response) = try await URLSession.shared.bytes(from: url)
			guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
				await MainActor.run { isSending = false }
				return
			}
			var assistantIndex: Int? = indexToReplace
			var accumulated = ""
			for try await line in bytes.lines {
				if line.isEmpty { continue }
				if line.hasPrefix("data: ") {
					let jsonStr = String(line.dropFirst(6))
					guard let data = jsonStr.data(using: .utf8),
							let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
					else { continue }
					let type = obj["type"] as? String ?? ""
					if type == "init" {
						if let cid = obj["conversationId"] as? String {
							await MainActor.run { self.conversationId = cid }
						}
						await MainActor.run {
							if assistantIndex == nil {
								messages.append(Message(role: "assistant", content: ""))
								assistantIndex = messages.count - 1
							} else if let idx = assistantIndex, idx < messages.count {
								messages[idx] = Message(role: "assistant", content: "")
							}
						}
					} else if type == "token" {
						let tok = obj["token"] as? String ?? ""
						accumulated += tok
						await MainActor.run {
							if let idx = assistantIndex, idx < messages.count {
								let current = messages[idx].content
								messages[idx] = Message(role: "assistant", content: current + tok)
							}
						}
					} else if type == "done" {
						let txt = (obj["text"] as? String) ?? accumulated
						await MainActor.run {
							if let idx = assistantIndex, idx < messages.count {
								messages[idx] = Message(role: "assistant", content: txt)
							}
							isSending = false
						}
					} else if type == "error" {
						await MainActor.run { isSending = false }
					}
				}
			}
		} catch {
			await MainActor.run { isSending = false }
		}
	}

	private func refreshBackend(conversationId: String?, model: String?, replaceAssistantAt: Int? = nil) async {
		guard let conversationId else { return }
		var request = URLRequest(url: apiBaseURL.appendingPathComponent("/v1/chat/refresh"))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		let body: [String: Any] = ["conversationId": conversationId, "model": model ?? ""]
		request.httpBody = try? JSONSerialization.data(withJSONObject: body)

		do {
			let (bytes, response) = try await URLSession.shared.bytes(for: request)
			guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
				await MainActor.run { isSending = false }
				return
			}
			var assistantIndex: Int? = replaceAssistantAt
			var accumulated = ""
			for try await line in bytes.lines {
				if line.isEmpty { continue }
				if line.hasPrefix("data: ") {
					let jsonStr = String(line.dropFirst(6))
					guard let data = jsonStr.data(using: String.Encoding.utf8),
							let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
					else { continue }
					let type = obj["type"] as? String ?? ""
					if type == "init" {
						if let cid = obj["conversationId"] as? String {
							await MainActor.run { self.conversationId = cid }
						}
						await MainActor.run {
							if assistantIndex == nil {
								messages.append(Message(role: "assistant", content: ""))
								assistantIndex = messages.count - 1
							} else if let idx = assistantIndex, idx < messages.count {
								messages[idx] = Message(role: "assistant", content: "")
							}
						}
					} else if type == "token" {
						let tok = obj["token"] as? String ?? ""
						accumulated += tok
						await MainActor.run {
							if let idx = assistantIndex, idx < messages.count {
								let current = messages[idx].content
								messages[idx] = Message(role: "assistant", content: current + tok)
							}
						}
					} else if type == "done" {
						let txt = (obj["text"] as? String) ?? accumulated
						await MainActor.run {
							if let idx = assistantIndex, idx < messages.count {
								messages[idx] = Message(role: "assistant", content: txt)
							}
							isSending = false
						}
					} else if type == "error" {
						await MainActor.run { isSending = false }
					}
				}
			}
		} catch {
			await MainActor.run { isSending = false }
		}
	}

	private func loadAvailableModels() {
		Task {
			let url = apiBaseURL.appendingPathComponent("/v1/models")
			var request = URLRequest(url: url)
			request.httpMethod = "GET"

			do {
				let (data, response) = try await URLSession.shared.data(for: request)
				guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
					await MainActor.run {
						isLoadingModels = false
					}
					return
				}

				let modelsResponse = try JSONDecoder().decode(ModelsResponse.self, from: data)
				await MainActor.run {
					availableModels = modelsResponse.models
					// Set default model if available
					if let defaultModel = modelsResponse.models.first(where: { $0.id == modelsResponse.default }) {
						selectedModel = defaultModel
					} else if let firstModel = modelsResponse.models.first {
						selectedModel = firstModel
					}
					isLoadingModels = false
				}
			} catch {
				await MainActor.run {
					isLoadingModels = false
				}
			}
		}
	}

	private func copyMessage(_ message: Message) {
		guard message.role == "assistant" else { return }
		NSPasteboard.general.clearContents()
		NSPasteboard.general.setString(message.content, forType: .string)
	}

	private func redoAssistantMessage(_ message: Message) {
		guard message.role == "assistant" else { return }
		guard let idx = messages.firstIndex(where: { $0.id == message.id }) else { return }
		isSending = true
		Task { await refreshBackend(conversationId: conversationId, model: selectedModel?.id, replaceAssistantAt: idx) }
	}
}


