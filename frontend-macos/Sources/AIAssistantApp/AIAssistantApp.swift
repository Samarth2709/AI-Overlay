import SwiftUI
import AppKit
import CoreText

@main
struct AIAssistantApp: App {
	@NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

	var body: some Scene {
		Settings { EmptyView() }
	}
}

final class AppDelegate: NSObject, NSApplicationDelegate {
	private var hotkeyManager: HotkeyManager?
	private var keyEventMonitor: Any?

	func applicationDidFinishLaunching(_ notification: Notification) {
		NSApp.setActivationPolicy(.accessory)
		FontRegistrar.registerAllCustomFonts()

		OverlayWindow.shared.initializeIfNeeded(rootView: AnyView(ContentView()))

		hotkeyManager = HotkeyManager { [weak self] in
			guard let self else { return }
			self.toggleOverlay()
			if OverlayWindow.shared.isVisible {
				self.focusInputAfterHotkey()
			}
		}
		hotkeyManager?.registerDefaultHotkey()
		
		// Add local event monitor for Cmd+N
		keyEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
			// Cmd+N → New chat
			if event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers == "n" {
				if OverlayWindow.shared.isVisible {
					self?.startNewChat()
					return nil // Consume the event
				}
			}
			// Cmd+M → Cycle models (only when overlay visible)
			if event.modifierFlags.contains(.command) && event.charactersIgnoringModifiers == "m" {
				if OverlayWindow.shared.isVisible {
					NotificationCenter.default.post(name: .cycleModel, object: nil)
					return nil // Consume the event
				}
			}
			return event
		}
	}
	
	deinit {
		if let monitor = keyEventMonitor {
			NSEvent.removeMonitor(monitor)
		}
	}

	private func toggleOverlay() {
		OverlayWindow.shared.toggle()
	}
	
	private func startNewChat() {
		// Post notification to ContentView to start new chat
		NotificationCenter.default.post(name: .startNewChat, object: nil)
	}

	private func focusInputAfterHotkey() {
		// Post a notification shortly after showing so SwiftUI can make the TextField first responder
		DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
			NotificationCenter.default.post(name: .focusInput, object: nil)
		}
	}
}

extension Notification.Name {
	static let startNewChat = Notification.Name("startNewChat")
	static let focusInput = Notification.Name("focusInput")
	static let cycleModel = Notification.Name("cycleModel")
}

// MARK: - Font Registration

enum FontRegistrar {
	static func registerAllCustomFonts() {
		// Locate the resources bundle produced by SwiftPM for this target
		let bundleName = "AIAssistantApp_AIAssistantApp"
		let candidates = [
			Bundle.main.resourceURL,
			Bundle(for: AppDelegate.self).resourceURL
		]
		var bundle: Bundle? = nil
		for candidate in candidates {
			if let candidate = candidate {
				let bundleURL = candidate.appendingPathComponent(bundleName + ".bundle")
				if let b = Bundle(url: bundleURL) { bundle = b; break }
			}
		}
		if bundle == nil { bundle = Bundle.main }
		guard let resourcesBundle = bundle, let rootURL = resourcesBundle.resourceURL else {
			print("[fonts] Resource bundle not found; skipping custom font registration")
			return
		}

		// Enumerate all .ttf files recursively inside the resources bundle
		var fontURLs: [URL] = []
		if let enumerator = FileManager.default.enumerator(at: rootURL, includingPropertiesForKeys: nil) {
			for case let url as URL in enumerator {
				if url.pathExtension.lowercased() == "ttf" { fontURLs.append(url) }
			}
		}

		if fontURLs.isEmpty {
			print("[fonts] No .ttf files found in bundle at \(rootURL.path)")
			return
		}

		for url in fontURLs {
			var error: Unmanaged<CFError>?
			let ok = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
			if ok {
				print("[fonts] Registered \(url.lastPathComponent)")
			} else if let e = error?.takeRetainedValue() {
				print("[fonts] Failed to register \(url.lastPathComponent): \(e)")
			}
		}
	}
}
