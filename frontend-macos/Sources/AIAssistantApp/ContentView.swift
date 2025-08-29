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
	@State private var showModelToast: Bool = false
	@State private var modelToastText: String = ""
	@State private var scrollToMessageId: UUID? = nil

	private let apiBaseURL = URL(string: "http://127.0.0.1:7071")!

	var body: some View {
		Group {
			if messages.isEmpty {
				// Compact input-only view
				CompactInputView(
					input: $input,
					isSending: $isSending,
					selectedModel: selectedModel,
					availableModels: availableModels,
					isLoadingModels: isLoadingModels,
					onModelSelect: { selectedModel = $0 },
					onSend: send,
					onNewChat: startNewChat
				)
			} else {
				// Expanded view with conversation
				ExpandedChatView(
					messages: messages,
					input: $input,
					isSending: $isSending,
					targetMessageId: scrollToMessageId,
					selectedModel: selectedModel,
					availableModels: availableModels,
					isLoadingModels: isLoadingModels,
					onModelSelect: { selectedModel = $0 },
					onSend: send,
					onNewChat: startNewChat,
					onCopy: copyMessage,
					onRedo: redoAssistantMessage
				)
			}
		}
		.onAppear {
			loadAvailableModels()
			updateWindowSize()
			// Focus the input field when the view appears
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
				isInputFocused = true
			}
		}
		.onChange(of: messages) { _ in
			updateWindowSize()
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
		.onReceive(NotificationCenter.default.publisher(for: .cycleModel)) { _ in
			cycleModel()
		}
		.overlay(alignment: .topTrailing) {
			if showModelToast {
				Text(modelToastText)
					.font(.custom("Montserrat", size: 11).weight(.medium))
					.padding(.horizontal, 10)
					.padding(.vertical, 6)
					.background(.ultraThinMaterial)
					.cornerRadius(8)
					.transition(.opacity.combined(with: .move(edge: .top)))
					.padding(.trailing, 10)
					.padding(.top, 10)
			}
		}
	}

	private func startNewChat() {
		messages.removeAll()
		conversationId = nil
	}

	private func cycleModel() {
		guard !availableModels.isEmpty else { return }
		if let current = selectedModel, let idx = availableModels.firstIndex(where: { $0.id == current.id }) {
			let nextIdx = (idx + 1) % availableModels.count
			selectedModel = availableModels[nextIdx]
		} else {
			selectedModel = availableModels.first
		}
		// Show toast
		if let name = selectedModel?.name {
			modelToastText = name
			showModelToast = true
			DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
				withAnimation(.easeOut(duration: 0.2)) { showModelToast = false }
			}
		}
	}
	
	private func updateWindowSize() {
		let width: CGFloat = 360
		let height: CGFloat = messages.isEmpty ? 60 : 400
		
		DispatchQueue.main.async {
			OverlayWindow.shared.updateSize(width: width, height: height, animated: !messages.isEmpty)
		}
	}

	private func send() {
		let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !text.isEmpty else { return }
		messages.append(Message(role: "user", content: text))
		input = ""
		isSending = true

		// Force scroll to bottom after adding user message
		// No auto-scroll on user message; assistant bubble will handle scroll

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
								let newMessage = Message(role: "assistant", content: "")
								messages.append(newMessage)
								assistantIndex = messages.count - 1
								// set target id for immediate scroll
								scrollToMessageId = newMessage.id
							} else if let idx = assistantIndex, idx < messages.count {
								messages[idx] = Message(role: "assistant", content: "")
								scrollToMessageId = messages[idx].id
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

// MARK: - Compact Input View

struct CompactInputView: View {
	@Binding var input: String
	@Binding var isSending: Bool
	@FocusState private var isInputFocused: Bool
	
	let selectedModel: Model?
	let availableModels: [Model]
	let isLoadingModels: Bool
	let onModelSelect: (Model) -> Void
	let onSend: () -> Void
	let onNewChat: () -> Void
	
	var body: some View {
		HStack(spacing: 8) {
			Image(systemName: "sparkles")
				.foregroundColor(.secondary)
				.font(.system(size: 12))
			
			TextField("Ask anything...", text: $input)
				.textFieldStyle(.plain)
				.font(.custom("Montserrat", size: 13).weight(.medium))
				.focused($isInputFocused)
				.onSubmit { onSend() }
			
			if !input.isEmpty {
				Button(action: onSend) {
					Image(systemName: "arrow.up.circle.fill")
						.foregroundColor(.primary)
						.font(.system(size: 16))
				}
				.buttonStyle(.plain)
				.opacity(isSending ? 0.5 : 1.0)
				.disabled(isSending)
			} else {
				Menu {
					if isLoadingModels {
						Text("Loading models...")
							.foregroundColor(.secondary)
					} else {
						ForEach(availableModels) { model in
							Button(action: { onModelSelect(model) }) {
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
					Image(systemName: "cube.box")
						.foregroundColor(.secondary)
						.font(.system(size: 12))
				}
				.buttonStyle(.plain)
				.disabled(isLoadingModels)
			}
		}
		.padding(.horizontal, 14)
		.padding(.vertical, 10)
		.frame(maxWidth: .infinity)
		.frame(height: 40)
		.onAppear {
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
				isInputFocused = true
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .focusInput)) { _ in
			DispatchQueue.main.async {
				isInputFocused = true
			}
		}
	}
}

// MARK: - Expanded Chat View

struct ExpandedChatView: View {
	let messages: [Message]
	@Binding var input: String
	@Binding var isSending: Bool
	let targetMessageId: UUID?
	@FocusState private var isInputFocused: Bool
	@State private var scrollViewID = UUID()
	@State private var lastContentLength = 0
	
	let selectedModel: Model?
	let availableModels: [Model]
	let isLoadingModels: Bool
	let onModelSelect: (Model) -> Void
	let onSend: () -> Void
	let onNewChat: () -> Void
	let onCopy: (Message) -> Void
	let onRedo: (Message) -> Void
	
	var body: some View {
		VStack(spacing: 0) {
			// Minimal header
			HStack(spacing: 8) {
				Text("dave")
					.font(.custom("Montserrat", size: 11).weight(.medium))
					.foregroundColor(.secondary)
				
				Spacer()
				
				Button(action: onNewChat) {
					Image(systemName: "plus.circle")
						.font(.system(size: 12))
						.foregroundColor(.secondary)
				}
				.buttonStyle(.plain)
				
				Menu {
					if isLoadingModels {
						Text("Loading models...")
							.foregroundColor(.secondary)
					} else {
						ForEach(availableModels) { model in
							Button(action: { onModelSelect(model) }) {
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
					Image(systemName: "cube.box")
						.foregroundColor(.secondary)
						.font(.system(size: 12))
				}
				.buttonStyle(.plain)
				.disabled(isLoadingModels)
			}
			.padding(.horizontal, 14)
			.padding(.vertical, 8)
			.overlay(alignment: .bottom) {
				Rectangle()
					.fill(Color.white.opacity(0.04))
					.frame(height: 0.5)
			}
			
			// Messages
			ScrollViewReader { proxy in
				ScrollView {
					LazyVStack(alignment: .leading, spacing: 10) {
						ForEach(messages) { msg in
							CompactChatBubble(
								message: msg,
								isTyping: isSending && msg.role == "assistant" && msg.content.isEmpty,
								onCopy: { onCopy(msg) },
								onRedo: { onRedo(msg) }
							)
							.id(msg.id)
						}
						// Invisible bottom anchor for scrolling to the very end
						Color.clear
							.frame(height: 1)
							.id("__scroll_bottom__")
					}
					.padding(.horizontal, 14)
					.padding(.vertical, 8)
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.id(scrollViewID)
				.onChange(of: targetMessageId) { _ in
					DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) {
						withAnimation(.easeOut(duration: 0.2)) {
							proxy.scrollTo("__scroll_bottom__", anchor: .bottom)
						}
					}
				}
				.onReceive(Timer.publish(every: 0.01, on: .main, in: .common).autoconnect()) { _ in
					// Check if content has changed during streaming
					if let lastMessage = messages.last, lastMessage.role == "assistant" {
						let currentLength = lastMessage.content.count
						if currentLength != lastContentLength {
							lastContentLength = currentLength
							// Scroll immediately on content change
							proxy.scrollTo("__scroll_bottom__", anchor: .bottom)
						}
					}
				}
			}
			
			// Input
			HStack(spacing: 8) {
							TextField("Ask anything...", text: $input)
				.textFieldStyle(.plain)
				.font(.custom("Montserrat", size: 12).weight(.medium))
				.focused($isInputFocused)
				.onSubmit { onSend() }
				
				Button(action: onSend) {
					Image(systemName: input.isEmpty ? "arrow.up.circle" : "arrow.up.circle.fill")
						.foregroundColor(input.isEmpty ? .secondary : .primary)
						.font(.system(size: 16))
				}
				.buttonStyle(.plain)
				.opacity(isSending ? 0.5 : 1.0)
				.disabled(isSending || input.isEmpty)
			}
			.padding(.horizontal, 14)
			.padding(.vertical, 10)
			.overlay(alignment: .top) {
				Rectangle()
					.fill(Color.white.opacity(0.04))
					.frame(height: 0.5)
			}
			// Toast is now at ContentView level, remove inner toast
		}
		.onAppear {
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
				isInputFocused = true
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .focusInput)) { _ in
			DispatchQueue.main.async {
				isInputFocused = true
			}
		}
	}
}

// MARK: - Compact Chat Bubble

struct CompactChatBubble: View {
	let message: Message
	var isTyping: Bool = false
	var onCopy: (() -> Void)? = nil
	var onRedo: (() -> Void)? = nil
	
	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			if message.role == "assistant" {
				VStack(alignment: .leading, spacing: 6) {
					Group {
						if isTyping && message.content.isEmpty {
							TypingDots()
								.frame(maxWidth: .infinity, alignment: .leading)
						} else {
							Text(message.content)
								.font(.custom("Montserrat", size: 13).weight(.light))
								.frame(maxWidth: .infinity, alignment: .leading)
								.textSelection(.enabled)
						}
					}
					
					if !isTyping && !message.content.isEmpty {
						HStack(spacing: 10) {
							Button(action: { onCopy?() }) {
								Image(systemName: "doc.on.doc")
									.font(.system(size: 10))
									.foregroundColor(.secondary)
							}
							.buttonStyle(.plain)
							
							Button(action: { onRedo?() }) {
								Image(systemName: "arrow.clockwise")
									.font(.system(size: 10))
									.foregroundColor(.secondary)
							}
							.buttonStyle(.plain)
						}
					}
				}
				.padding(10)
				.background(.ultraThinMaterial)
				.cornerRadius(10)
				.frame(maxWidth: .infinity, alignment: .leading)
			} else {
				Spacer(minLength: 30)
				Text(message.content)
					.font(.custom("Montserrat", size: 12).weight(.medium))
					.padding(.vertical, 8)
					.padding(.horizontal, 12)
					.background(Color.white.opacity(0.1))
					.cornerRadius(10)
					.frame(maxWidth: 280, alignment: .trailing)
			}
		}
	}
}


