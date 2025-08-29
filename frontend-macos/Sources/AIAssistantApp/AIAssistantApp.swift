import SwiftUI
import AppKit
import CoreText

/**
 * AI Assistant macOS Application
 * 
 * This is the main entry point for the AI Assistant macOS app.
 * The app runs as a menu bar utility (accessory app) that provides
 * a floating overlay window for AI chat interactions.
 */
@main
struct AIAssistantApp: App {
	/// App delegate that handles application lifecycle and window management
	@NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

	var body: some Scene {
		/// Empty settings window - the app primarily uses an overlay window
		Settings { EmptyView() }
	}
}

/**
 * Application Delegate
 * 
 * Manages the application lifecycle, global hotkeys, and overlay window initialization.
 * This delegate sets up the app to run as an accessory (menu bar) application and
 * handles keyboard shortcuts for showing/hiding the chat interface.
 */
final class AppDelegate: NSObject, NSApplicationDelegate {
	/// Manages global hotkey registration (Option + Space by default)
	private var hotkeyManager: HotkeyManager?
	/// Monitors local key events for additional shortcuts (Cmd+N, Cmd+M)
	private var keyEventMonitor: Any?

	/**
	 * Called when the application finishes launching
	 * Sets up the app as an accessory, registers fonts, initializes the overlay window,
	 * and configures global hotkeys and keyboard shortcuts.
	 */
	func applicationDidFinishLaunching(_ notification: Notification) {
		// Set app to run as an accessory (menu bar utility) instead of dock app
		NSApp.setActivationPolicy(.accessory)
		
		// Register custom fonts (Montserrat, Tektur, etc.) for the UI
		FontRegistrar.registerAllCustomFonts()

		// Initialize the floating overlay window with the main content view
		OverlayWindow.shared.initializeIfNeeded(rootView: AnyView(ContentView()))

		// Set up global hotkey (Option + Space) to toggle the overlay
		hotkeyManager = HotkeyManager { [weak self] in
			guard let self else { return }
			self.toggleOverlay()
			// Focus the input field when showing the overlay
			if OverlayWindow.shared.isVisible {
				self.focusInputAfterHotkey()
			}
		}
		hotkeyManager?.registerDefaultHotkey()
		
		// Monitor local keyboard events for additional shortcuts
		keyEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
			// Cmd+N → Start new chat (only when overlay is visible)
			if event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers == "n" {
				if OverlayWindow.shared.isVisible {
					self?.startNewChat()
					return nil // Consume the event to prevent system handling
				}
			}
			// Cmd+M → Cycle through available AI models (only when overlay visible)
			if event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers == "m" {
				if OverlayWindow.shared.isVisible {
					NotificationCenter.default.post(name: .cycleModel, object: nil)
					return nil // Consume the event
				}
			}
			return event // Let system handle other events
		}
	}
	
	/**
	 * Cleanup when the app delegate is deallocated
	 * Removes the keyboard event monitor to prevent memory leaks
	 */
	deinit {
		if let monitor = keyEventMonitor {
			NSEvent.removeMonitor(monitor)
		}
	}

	/**
	 * Toggles the visibility of the overlay window
	 * Called when the global hotkey (Option + Space) is pressed
	 */
	private func toggleOverlay() {
		OverlayWindow.shared.toggle()
	}
	
	/**
	 * Starts a new chat conversation
	 * Posts a notification that ContentView listens for to clear the current conversation
	 */
	private func startNewChat() {
		NotificationCenter.default.post(name: .startNewChat, object: nil)
	}

	/**
	 * Focuses the input field after the hotkey shows the overlay
	 * Uses a slight delay to ensure SwiftUI has time to set up the TextField
	 */
	private func focusInputAfterHotkey() {
		DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
			NotificationCenter.default.post(name: .focusInput, object: nil)
		}
	}
}

/**
 * Custom notification names for inter-component communication
 * These notifications allow the app delegate to communicate with SwiftUI views
 */
extension Notification.Name {
	/// Posted when user wants to start a new chat conversation (Cmd+N)
	static let startNewChat = Notification.Name("startNewChat")
	/// Posted to focus the input field after showing the overlay
	static let focusInput = Notification.Name("focusInput")
	/// Posted when user wants to cycle through AI models (Cmd+M)
	static let cycleModel = Notification.Name("cycleModel")
}

// MARK: - Font Registration

/**
 * Font Registrar
 * 
 * Handles registration of custom fonts bundled with the application.
 * Searches for .ttf files in the app bundle and registers them with Core Text
 * so they can be used throughout the SwiftUI interface.
 */
enum FontRegistrar {
	/**
	 * Registers all custom fonts found in the app bundle
	 * 
	 * This function searches for .ttf font files in the application's resource bundle
	 * and registers them with Core Text so they can be used with SwiftUI's .custom() font modifier.
	 * The app includes Montserrat and Tektur fonts for the UI.
	 * 
	 * Font registration is necessary because:
	 * 1. Custom fonts must be explicitly registered with Core Text before use
	 * 2. SwiftUI's .custom() modifier requires fonts to be available system-wide
	 * 3. Fonts are bundled as resources and need to be loaded at runtime
	 * 
	 * The function handles:
	 * - Bundle discovery in different build configurations (debug/release)
	 * - Recursive font file discovery in nested directories
	 * - Error handling for missing fonts or registration failures
	 * - Logging of successful registrations and errors
	 */
	static func registerAllCustomFonts() {
		// Step 1: Locate the resources bundle produced by SwiftPM for this target
		// SwiftPM creates a bundle with the target name plus "_TargetName" suffix
		let bundleName = "AIAssistantApp_AIAssistantApp"
		
		// Step 2: Define possible bundle locations
		// Try multiple locations because bundle location varies between debug/release builds
		let candidates = [
			Bundle.main.resourceURL,                    // Main app bundle
			Bundle(for: AppDelegate.self).resourceURL   // Bundle containing this class
		]
		
		// Step 3: Find the correct bundle containing font resources
		// Search through candidates to locate the actual resource bundle
		var bundle: Bundle? = nil
		for candidate in candidates {
			if let candidate = candidate {
				// Construct the expected bundle path by appending the bundle name
				let bundleURL = candidate.appendingPathComponent(bundleName + ".bundle")
				if let b = Bundle(url: bundleURL) { 
					bundle = b; 
					break // Found the bundle, stop searching
				}
			}
		}
		
		// Fallback to main bundle if no specific resource bundle found
		// This handles cases where fonts might be directly in the main bundle
		if bundle == nil { bundle = Bundle.main }
		
		// Step 4: Validate that we have a valid bundle with resources
		guard let resourcesBundle = bundle, let rootURL = resourcesBundle.resourceURL else {
			print("[fonts] Resource bundle not found; skipping custom font registration")
			return
		}

		// Step 5: Recursively find all .ttf font files in the bundle
		// Use FileManager to enumerate all files in the bundle directory
		var fontURLs: [URL] = []
		if let enumerator = FileManager.default.enumerator(at: rootURL, includingPropertiesForKeys: nil) {
			for case let url as URL in enumerator {
				// Check if the file is a TrueType font (.ttf extension)
				if url.pathExtension.lowercased() == "ttf" { 
					fontURLs.append(url) 
				}
			}
		}

		// Step 6: Exit early if no fonts found
		// This prevents unnecessary processing and provides clear feedback
		if fontURLs.isEmpty {
			print("[fonts] No .ttf files found in bundle at \(rootURL.path)")
			return
		}

		// Step 7: Register each font with Core Text
		// This makes the fonts available to the entire application
		for url in fontURLs {
			var error: Unmanaged<CFError>?
			
			// Register the font with Core Text using the process scope
			// .process scope means the font is available only to this application
			let ok = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
			
			if ok {
				// Success: font is now available for use with SwiftUI
				print("[fonts] Registered \(url.lastPathComponent)")
			} else if let e = error?.takeRetainedValue() {
				// Failure: log the specific error for debugging
				print("[fonts] Failed to register \(url.lastPathComponent): \(e)")
			}
		}
	}
}
