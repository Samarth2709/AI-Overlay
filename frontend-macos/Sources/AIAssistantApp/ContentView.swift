import SwiftUI
import AppKit

// MARK: - Data Models

/**
 * Represents an AI model that can be selected for conversations
 * Contains metadata about each available model from the backend
 */
struct Model: Identifiable, Codable {
	let id: String        // Unique identifier for the model
	let name: String      // Display name for the model
	let description: String // Brief description of the model's capabilities
}

/**
 * Response structure from the models API endpoint
 * Contains the list of available models and the default selection
 */
struct ModelsResponse: Codable {
	let models: [Model]     // Array of available AI models
	let `default`: String   // ID of the default model to use
}

/**
 * Represents a single message in the chat conversation
 * Can be either from the user or the AI assistant
 */
struct Message: Identifiable, Equatable {
	let id = UUID()        // Unique identifier for the message
	let role: String       // Either "user" or "assistant"
	let content: String    // The actual message content

	static func == (lhs: Message, rhs: Message) -> Bool {
		lhs.id == rhs.id && lhs.role == rhs.role && lhs.content == rhs.content
	}
}

// MARK: - UI Components

/**
 * Animated typing indicator shown when the assistant is generating a response
 * Displays three bouncing dots with staggered animation timing
 */
struct TypingDots: View {
	@State private var animate = false
	
	var body: some View {
		HStack(spacing: 6) {
			ForEach(0..<3) { index in
				Circle()
					.fill(Color.white)
					.frame(width: 8, height: 8)
					// Scale animation: dots grow and shrink
					.scaleEffect(animate ? 1.0 : 0.6)
					// Vertical bounce animation: dots move up and down
					.offset(y: animate ? -2 : 2)
					// Staggered animation: each dot starts with a 0.1s delay
					.animation(.easeInOut(duration: 0.35).repeatForever().delay(Double(index) * 0.10), value: animate)
			}
		}
		.onAppear { animate = true }
		.accessibilityLabel("Assistant is typing")
	}
}

/**
 * Chat bubble component for displaying messages in the conversation
 * Handles both user and assistant messages with different styling and actions
 */
struct ChatBubble: View {
	let message: Message              // The message to display
	var isTyping: Bool = false        // Whether to show typing animation
	var onCopy: (() -> Void)? = nil   // Callback for copy action
	var onRedo: (() -> Void)? = nil   // Callback for regenerate action
	
	var body: some View {
		HStack(alignment: .top) {
			if message.role == "assistant" {
				// Assistant message: left-aligned with glassmorphism background
				VStack(alignment: .leading, spacing: 10) {
					Group {
						if isTyping && message.content.isEmpty {
							// Show typing animation when assistant is responding
							TypingDots()
								.frame(maxWidth: .infinity, alignment: .leading)
						} else {
							// Show actual message content
							Text(message.content)
								.font(.custom("Montserrat", size: 15).weight(.light))
								.frame(maxWidth: .infinity, alignment: .leading)
						}
					}
					if !isTyping && !message.content.isEmpty {
						// Action buttons: copy and regenerate (only for completed messages)
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
				.background(.ultraThinMaterial) // Glassmorphism effect
				.cornerRadius(14)
				.frame(maxWidth: .infinity, alignment: .leading)
			} else {
				// User message: right-aligned with subtle background
				Spacer(minLength: 40) // Push message to the right
				Text(message.content)
					.font(.custom("Montserrat", size: 14).weight(.medium))
					.padding(.vertical, 10)
					.padding(.horizontal, 14)
					.background(Color.gray.opacity(0.25)) // Subtle gray background
					.cornerRadius(16)
					.frame(maxWidth: 380, alignment: .trailing) // Limit width for readability
			}
		}
	}
}


// MARK: - Main Content View

/**
 * Main content view for the AI Assistant chat interface
 * 
 * Manages the chat conversation, model selection, and communication with the backend API.
 * Dynamically switches between a compact input-only view and an expanded chat view
 * based on whether there are active messages in the conversation.
 */
struct ContentView: View {
	// MARK: - State Properties
	
	/// Array of messages in the current conversation
	@State private var messages: [Message] = []
	/// Current input text from the user
	@State private var input: String = ""
	/// Whether a message is currently being sent to the backend
	@State private var isSending: Bool = false
	/// Unique identifier for the current conversation
	@State private var conversationId: String? = nil

	/// List of available AI models from the backend
	@State private var availableModels: [Model] = []
	/// Currently selected AI model for the conversation
	@State private var selectedModel: Model?
	/// Whether the models are still being loaded from the backend
	@State private var isLoadingModels: Bool = true
	/// Focus state for the input text field
	@FocusState private var isInputFocused: Bool
	/// Whether to show the model selection toast notification
	@State private var showModelToast: Bool = false
	/// Text to display in the model selection toast
	@State private var modelToastText: String = ""
	/// ID of message to scroll to (used for auto-scrolling during streaming)
	@State private var scrollToMessageId: UUID? = nil

	/// Base URL for the backend API server
	private let apiBaseURL = URL(string: "http://127.0.0.1:7071")!

	var body: some View {
		Group {
			if messages.isEmpty {
				// Show compact input-only view when no conversation is active
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
				// Show expanded view with full conversation when messages exist
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
			// Initialize the view when it first appears
			loadAvailableModels()
			updateWindowSize()
			// Focus the input field after a brief delay to ensure proper setup
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
				isInputFocused = true
			}
		}
		.onChange(of: messages) { _ in
			// Update window size when conversation changes (compact vs expanded)
			updateWindowSize()
		}
		.onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
			// Re-focus input when the app becomes active (user switches back to it)
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
				isInputFocused = true
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .focusInput)) { _ in
			// Focus input when hotkey is used to show the overlay
			DispatchQueue.main.async {
				isInputFocused = true
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .startNewChat)) { _ in
			// Handle Cmd+N shortcut to start a new conversation
			startNewChat()
		}
		.onReceive(NotificationCenter.default.publisher(for: .cycleModel)) { _ in
			// Handle Cmd+M shortcut to cycle through available models
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

	// MARK: - Helper Methods
	
	/**
	 * Starts a new chat conversation
	 * Clears all messages and resets the conversation ID
	 */
	private func startNewChat() {
		messages.removeAll()
		conversationId = nil
	}

	/**
	 * Cycles through available AI models
	 * Shows a toast notification with the newly selected model name
	 */
	private func cycleModel() {
		guard !availableModels.isEmpty else { return }
		
		// Find current model index and select the next one (wrapping around)
		if let current = selectedModel, let idx = availableModels.firstIndex(where: { $0.id == current.id }) {
			let nextIdx = (idx + 1) % availableModels.count
			selectedModel = availableModels[nextIdx]
		} else {
			selectedModel = availableModels.first
		}
		
		// Show temporary toast with the new model name
		if let name = selectedModel?.name {
			modelToastText = name
			showModelToast = true
			DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
				withAnimation(.easeOut(duration: 0.2)) { showModelToast = false }
			}
		}
	}
	
	/**
	 * Updates the overlay window size based on current conversation state
	 * Compact size (60px height) when no messages, expanded (400px) with conversation
	 */
	private func updateWindowSize() {
		let width: CGFloat = 360
		let height: CGFloat = messages.isEmpty ? 60 : 400
		
		DispatchQueue.main.async {
			OverlayWindow.shared.updateSize(width: width, height: height, animated: !messages.isEmpty)
		}
	}

	// MARK: - Message Handling
	
	/**
	 * Sends the current input as a message to the AI assistant
	 * Adds the user message to the conversation and initiates streaming response
	 */
	private func send() {
		// Prevent sending while an AI response is in progress to avoid conflicts
		guard !isSending else { return }
		
		// Clean up input text by removing leading/trailing whitespace
		let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
		guard !text.isEmpty else { return } // Don't send empty messages
		
		// Add user message to conversation immediately for instant feedback
		messages.append(Message(role: "user", content: text))
		input = "" // Clear input field
		isSending = true // Set sending state to show loading indicators

		// Start streaming response from the backend asynchronously
		// Note: Auto-scroll will be handled by the assistant's response
		Task { await streamBackend(message: text, conversationId: conversationId, model: selectedModel?.id, regenerate: false) }
	}

	// MARK: - API Communication
	
	/**
	 * Sends a message to the backend API and returns the complete response
	 * This is the non-streaming version, currently unused in favor of streaming
	 * 
	 * - Parameter message: The user's message to send
	 * - Parameter conversationId: Optional conversation ID to continue an existing chat
	 * - Parameter model: Optional model ID to specify which AI model to use
	 * - Returns: The assistant's response text, or nil if the request failed
	 */
	private func callBackend(message: String, conversationId: String?, model: String?) async -> String? {
		let url = apiBaseURL.appendingPathComponent("/v1/chat")
		var request = URLRequest(url: url)
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		
		// Build request body with message and optional parameters
		var body: [String: Any] = ["message": message]
		if let conversationId { body["conversationId"] = conversationId }
		if let model { body["model"] = model }
		request.httpBody = try? JSONSerialization.data(withJSONObject: body)

		do {
			let (data, response) = try await URLSession.shared.data(for: request)
			guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { return nil }
			
			if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
				// Update conversation ID if provided in response
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

	/**
	 * Streams a response from the backend API with real-time token updates
	 * This provides a more responsive user experience by showing text as it's generated
	 * 
	 * - Parameter message: The user's message to send
	 * - Parameter conversationId: Optional conversation ID to continue an existing chat
	 * - Parameter model: Optional model ID to specify which AI model to use
	 * - Parameter indexToReplace: Optional index of existing assistant message to replace (for regeneration)
	 * - Parameter regenerate: Whether this is a regeneration request
	 */
	private func streamBackend(message: String, conversationId: String?, model: String?, replaceAssistantAt indexToReplace: Int? = nil, regenerate: Bool = false) async {
		// Build URL with query parameters for the streaming endpoint
		var components = URLComponents(url: apiBaseURL.appendingPathComponent("/v1/chat/stream"), resolvingAgainstBaseURL: false)!
		var items: [URLQueryItem] = [URLQueryItem(name: "message", value: message)]
		
		// Add optional parameters if they exist
		if let conversationId { items.append(URLQueryItem(name: "conversationId", value: conversationId)) }
		if let model { items.append(URLQueryItem(name: "model", value: model)) }
		if regenerate { items.append(URLQueryItem(name: "regenerate", value: "1")) }
		
		components.queryItems = items
		guard let url = components.url else { 
			await MainActor.run { isSending = false }; 
			return 
		}
		
		do {
			// Start streaming connection to receive real-time tokens
			let (bytes, response) = try await URLSession.shared.bytes(from: url)
			
			// Validate HTTP response status
			guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
				await MainActor.run { isSending = false }
				return
			}
			
			// Track the assistant message index and accumulated text
			var assistantIndex: Int? = indexToReplace
			var accumulated = ""
			
			// Process each line of the server-sent events stream
			for try await line in bytes.lines {
				if line.isEmpty { continue } // Skip empty lines
				
				// Parse server-sent events format: "data: {json}"
				if line.hasPrefix("data: ") {
					let jsonStr = String(line.dropFirst(6)) // Remove "data: " prefix
					guard let data = jsonStr.data(using: .utf8),
							let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
					else { continue } // Skip malformed JSON
					
					let type = obj["type"] as? String ?? ""
					
					if type == "init" {
						// Initialize new conversation or message
						if let cid = obj["conversationId"] as? String {
							await MainActor.run { self.conversationId = cid }
						}
						await MainActor.run {
							if assistantIndex == nil {
								// Create new assistant message for fresh response
								let newMessage = Message(role: "assistant", content: "")
								messages.append(newMessage)
								assistantIndex = messages.count - 1
								// Set target ID for immediate auto-scroll
								scrollToMessageId = newMessage.id
							} else if let idx = assistantIndex, idx < messages.count {
								// Replace existing message for regeneration
								messages[idx] = Message(role: "assistant", content: "")
								scrollToMessageId = messages[idx].id
							}
						}
					} else if type == "token" {
						// Process individual token from the AI response
						let tok = obj["token"] as? String ?? ""
						accumulated += tok // Keep track of full response for fallback
						
						await MainActor.run {
							if let idx = assistantIndex, idx < messages.count {
								// Update the message content with new token
								let current = messages[idx].content
								messages[idx] = Message(role: "assistant", content: current + tok)
							}
						}
					} else if type == "done" {
						// Finalize the response with complete text
						let txt = (obj["text"] as? String) ?? accumulated // Use provided text or accumulated
						await MainActor.run {
							if let idx = assistantIndex, idx < messages.count {
								messages[idx] = Message(role: "assistant", content: txt)
							}
							isSending = false // Mark as complete
						}
					} else if type == "error" {
						// Handle streaming errors
						await MainActor.run { isSending = false }
					}
				}
			}
		} catch {
			// Handle network or parsing errors
			await MainActor.run { isSending = false }
		}
	}

	/**
	 * Refreshes/regenerates an assistant message using the conversation context
	 * Similar to streamBackend but uses the refresh endpoint for regeneration
	 */
	private func refreshBackend(conversationId: String?, model: String?, replaceAssistantAt: Int? = nil) async {
		guard let conversationId else { return } // Need conversation ID for refresh
		
		// Build request to the refresh endpoint
		var request = URLRequest(url: apiBaseURL.appendingPathComponent("/v1/chat/refresh"))
		request.httpMethod = "POST"
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		
		// Send conversation ID and model for regeneration
		let body: [String: Any] = ["conversationId": conversationId, "model": model ?? ""]
		request.httpBody = try? JSONSerialization.data(withJSONObject: body)

		do {
			// Start streaming connection for the refreshed response
			let (bytes, response) = try await URLSession.shared.bytes(for: request)
			
			// Validate HTTP response
			guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
				await MainActor.run { isSending = false }
				return
			}
			
			// Track message index and accumulated text (same as streamBackend)
			var assistantIndex: Int? = replaceAssistantAt
			var accumulated = ""
			
			// Process streaming response (same logic as streamBackend)
			for try await line in bytes.lines {
				if line.isEmpty { continue }
				if line.hasPrefix("data: ") {
					let jsonStr = String(line.dropFirst(6))
					guard let data = jsonStr.data(using: String.Encoding.utf8),
							let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
					else { continue }
					
					let type = obj["type"] as? String ?? ""
					if type == "init" {
						// Initialize regeneration
						if let cid = obj["conversationId"] as? String {
							await MainActor.run { self.conversationId = cid }
						}
						await MainActor.run {
							if assistantIndex == nil {
								// Create new message if no index provided
								messages.append(Message(role: "assistant", content: ""))
								assistantIndex = messages.count - 1
							} else if let idx = assistantIndex, idx < messages.count {
								// Clear existing message for regeneration
								messages[idx] = Message(role: "assistant", content: "")
							}
						}
					} else if type == "token" {
						// Process streaming tokens
						let tok = obj["token"] as? String ?? ""
						accumulated += tok
						await MainActor.run {
							if let idx = assistantIndex, idx < messages.count {
								let current = messages[idx].content
								messages[idx] = Message(role: "assistant", content: current + tok)
							}
						}
					} else if type == "done" {
						// Finalize regenerated response
						let txt = (obj["text"] as? String) ?? accumulated
						await MainActor.run {
							if let idx = assistantIndex, idx < messages.count {
								messages[idx] = Message(role: "assistant", content: txt)
							}
							isSending = false
						}
					} else if type == "error" {
						// Handle regeneration errors
						await MainActor.run { isSending = false }
					}
				}
			}
		} catch {
			// Handle network errors during regeneration
			await MainActor.run { isSending = false }
		}
	}

	/**
	 * Loads the list of available AI models from the backend
	 * Sets the default model as specified by the backend, or the first available model
	 */
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
					// Set default model as specified by backend, or fall back to first available
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

	/**
	 * Copies an assistant message to the system clipboard
	 * Only works for assistant messages, user messages cannot be copied
	 */
	private func copyMessage(_ message: Message) {
		guard message.role == "assistant" else { return }
		NSPasteboard.general.clearContents()
		NSPasteboard.general.setString(message.content, forType: .string)
	}

	/**
	 * Regenerates an assistant message by requesting a new response
	 * Replaces the existing message with a fresh response from the AI
	 */
	private func redoAssistantMessage(_ message: Message) {
		guard message.role == "assistant" else { return }
		guard let idx = messages.firstIndex(where: { $0.id == message.id }) else { return }
		isSending = true
		Task { await refreshBackend(conversationId: conversationId, model: selectedModel?.id, replaceAssistantAt: idx) }
	}
}

// MARK: - Compact Input View

/**
 * Compact input view shown when no conversation is active
 * Provides a minimal interface with just the input field and model selector
 * Automatically expands to full chat view once a conversation begins
 */
struct CompactInputView: View {
	@Binding var input: String           // User's input text
	@Binding var isSending: Bool         // Whether a message is being sent
	@FocusState private var isInputFocused: Bool
	
	let selectedModel: Model?            // Currently selected AI model
	let availableModels: [Model]         // List of available models
	let isLoadingModels: Bool           // Whether models are still loading
	let onModelSelect: (Model) -> Void   // Callback for model selection
	let onSend: () -> Void              // Callback for sending message
	let onNewChat: () -> Void           // Callback for starting new chat
	
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

/**
 * Expanded chat view shown when there are active messages in the conversation
 * Displays the full conversation history with scrolling, plus input field and controls
 * Includes header with new chat button and model selector
 */
struct ExpandedChatView: View {
	let messages: [Message]              // Array of conversation messages
	@Binding var input: String           // User's input text
	@Binding var isSending: Bool         // Whether a message is being sent
	let targetMessageId: UUID?           // Message ID to scroll to
	@FocusState private var isInputFocused: Bool
	@State private var scrollViewID = UUID()
	@State private var lastContentLength = 0
	
	let selectedModel: Model?            // Currently selected AI model
	let availableModels: [Model]         // List of available models
	let isLoadingModels: Bool           // Whether models are still loading
	let onModelSelect: (Model) -> Void   // Callback for model selection
	let onSend: () -> Void              // Callback for sending message
	let onNewChat: () -> Void           // Callback for starting new chat
	let onCopy: (Message) -> Void       // Callback for copying messages
	let onRedo: (Message) -> Void       // Callback for regenerating messages
	
	var body: some View {
		VStack(spacing: 0) {
			// Header bar with app title and controls
			HStack(spacing: 8) {
				// App title/branding
				Text("dave")
					.font(.custom("Montserrat", size: 11).weight(.medium))
					.foregroundColor(.secondary)
				
				Spacer()
				
				// New chat button
				Button(action: onNewChat) {
					Image(systemName: "plus.circle")
						.font(.system(size: 12))
						.foregroundColor(.secondary)
				}
				.buttonStyle(.plain)
				
				// Model selector dropdown menu
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
				// Subtle separator line below header
				Rectangle()
					.fill(Color.white.opacity(0.04))
					.frame(height: 0.5)
			}
			
			// Messages scrollable area
			ScrollViewReader { proxy in
				ScrollView {
					LazyVStack(alignment: .leading, spacing: 10) {
						ForEach(messages) { msg in
							// Render each message as a compact chat bubble
							CompactChatBubble(
								message: msg,
								isTyping: isSending && msg.role == "assistant" && msg.content.isEmpty,
								onCopy: { onCopy(msg) },
								onRedo: { onRedo(msg) }
							)
							.id(msg.id) // Unique ID for scrolling and animations
						}
						// Invisible bottom anchor for scrolling to the very end
						// This ensures we can always scroll to the bottom of the conversation
						Color.clear
							.frame(height: 1)
							.id("__scroll_bottom__")
					}
					.padding(.horizontal, 14)
					.padding(.vertical, 8)
				}
				.frame(maxWidth: .infinity, maxHeight: .infinity)
				.id(scrollViewID) // Unique ID for scroll view updates
				.onChange(of: targetMessageId) { _ in
					// Auto-scroll when a new message is added
					DispatchQueue.main.asyncAfter(deadline: .now() + 0.02) {
						withAnimation(.easeOut(duration: 0.2)) {
							proxy.scrollTo("__scroll_bottom__", anchor: .bottom)
						}
					}
				}
				.onReceive(Timer.publish(every: 0.01, on: .main, in: .common).autoconnect()) { _ in
					// Real-time auto-scroll during streaming responses
					// Check if the last message (assistant) content has changed
					if let lastMessage = messages.last, lastMessage.role == "assistant" {
						let currentLength = lastMessage.content.count
						if currentLength != lastContentLength {
							lastContentLength = currentLength
							// Scroll immediately when new tokens arrive
							proxy.scrollTo("__scroll_bottom__", anchor: .bottom)
						}
					}
				}
			}
			
			// Input area at bottom
			HStack(spacing: 8) {
				// Text input field
				TextField("Ask anything...", text: $input)
					.textFieldStyle(.plain)
					.font(.custom("Montserrat", size: 12).weight(.medium))
					.focused($isInputFocused)
					.onSubmit { onSend() } // Send on Enter key
				
				// Send button with dynamic appearance
				Button(action: onSend) {
					Image(systemName: input.isEmpty ? "arrow.up.circle" : "arrow.up.circle.fill")
						.foregroundColor(input.isEmpty ? .secondary : .primary)
						.font(.system(size: 16))
				}
				.buttonStyle(.plain)
				.opacity(isSending ? 0.5 : 1.0) // Dim when sending
				.disabled(isSending || input.isEmpty) // Disable when sending or no input
			}
			.padding(.horizontal, 14)
			.padding(.vertical, 10)
			.overlay(alignment: .top) {
				// Subtle separator line above input
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

/**
 * Compact version of chat bubble used in the expanded chat view
 * More space-efficient than the regular ChatBubble, designed for scrolling lists
 * Supports text selection and includes copy/redo actions for assistant messages
 */
struct CompactChatBubble: View {
	let message: Message              // Message to display
	var isTyping: Bool = false        // Whether to show typing animation
	var onCopy: (() -> Void)? = nil   // Callback for copy action
	var onRedo: (() -> Void)? = nil   // Callback for regenerate action
	
	var body: some View {
		HStack(alignment: .top, spacing: 8) {
			if message.role == "assistant" {
				// Assistant message: left-aligned with glassmorphism background
				VStack(alignment: .leading, spacing: 6) {
					Group {
						if isTyping && message.content.isEmpty {
							// Show typing animation when assistant is responding
							TypingDots()
								.frame(maxWidth: .infinity, alignment: .leading)
						} else {
							// Show actual message content with text selection enabled
							Text(message.content)
								.font(.custom("Montserrat", size: 13).weight(.light))
								.frame(maxWidth: .infinity, alignment: .leading)
								.textSelection(.enabled) // Allow users to select and copy text
						}
					}
					
					if !isTyping && !message.content.isEmpty {
						// Action buttons: copy and regenerate (only for completed messages)
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
				.background(.ultraThinMaterial) // Glassmorphism effect
				.cornerRadius(10)
				.frame(maxWidth: .infinity, alignment: .leading)
			} else {
				// User message: right-aligned with subtle background
				Spacer(minLength: 30) // Push message to the right
				Text(message.content)
					.font(.custom("Montserrat", size: 12).weight(.medium))
					.padding(.vertical, 8)
					.padding(.horizontal, 12)
					.background(Color.white.opacity(0.1)) // Subtle white background
					.cornerRadius(10)
					.frame(maxWidth: 280, alignment: .trailing) // Limit width for readability
			}
		}
	}
}


