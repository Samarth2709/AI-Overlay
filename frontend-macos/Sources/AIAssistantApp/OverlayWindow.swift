import SwiftUI
import AppKit

final class OverlayWindow {
	static let shared = OverlayWindow()

	private var panel: NSPanel?
	private var hostingView: NSHostingView<AnyView>?
	private var escMonitor: Any?
	
	var isVisible: Bool {
		return panel?.isVisible ?? false
	}

	func initializeIfNeeded(rootView: AnyView) {
		guard panel == nil else { return }

		let panel = NSPanel(
			contentRect: CGRect(x: 0, y: 0, width: 420, height: 420),
			styleMask: [.utilityWindow, .titled, .closable, .resizable],
			backing: .buffered,
			defer: false
		)
		panel.titleVisibility = .hidden
		panel.titlebarAppearsTransparent = true
		panel.isFloatingPanel = true
		panel.hidesOnDeactivate = false
		panel.level = .floating
		panel.hasShadow = true
		panel.isOpaque = false
		panel.backgroundColor = .clear
		panel.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
		panel.isMovableByWindowBackground = true
		panel.animationBehavior = .utilityWindow

		let effect = NSVisualEffectView()
		effect.material = .hudWindow
		effect.blendingMode = .withinWindow
		effect.state = .active
		effect.translatesAutoresizingMaskIntoConstraints = false
		effect.wantsLayer = true
		effect.layer?.cornerRadius = 18
		effect.layer?.masksToBounds = true
		effect.layer?.borderWidth = 1
		effect.layer?.borderColor = NSColor.white.withAlphaComponent(0.08).cgColor

		let hosting = NSHostingView(rootView: rootView)
		hosting.translatesAutoresizingMaskIntoConstraints = false
		effect.addSubview(hosting)

		NSLayoutConstraint.activate([
			hosting.leadingAnchor.constraint(equalTo: effect.leadingAnchor, constant: 12),
			hosting.trailingAnchor.constraint(equalTo: effect.trailingAnchor, constant: -12),
			hosting.topAnchor.constraint(equalTo: effect.topAnchor, constant: 12),
			hosting.bottomAnchor.constraint(equalTo: effect.bottomAnchor, constant: -12)
		])

		panel.contentView = effect

		self.panel = panel
		self.hostingView = hosting

		centerOnMainScreen()
		hide()
	}

	func show() {
		guard let panel else { return }
		centerOnMainScreen()
		if escMonitor == nil {
			escMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
				if event.keyCode == 53 {
					self?.hide()
					return nil
				}
				return event
			}
		}
		
		// Activate the app and bring the panel to front
		NSApp.activate(ignoringOtherApps: true)
		panel.makeKeyAndOrderFront(nil)
		
		// Ensure the panel becomes the key window and can accept text input
		DispatchQueue.main.async {
			panel.makeKey()
			panel.makeFirstResponder(panel.contentView)
		}
	}

	func hide() {
		panel?.orderOut(nil)
		if let escMonitor { NSEvent.removeMonitor(escMonitor) }
		escMonitor = nil
	}

	func toggle() {
		guard let panel else { return }
		if panel.isVisible { hide() } else { show() }
	}

	private func centerOnMainScreen() {
		guard let panel else { return }
		if let screen = NSScreen.main {
			let rect = screen.visibleFrame
			let x = rect.origin.x + (rect.size.width - panel.frame.size.width) / 2
			let y = rect.origin.y + (rect.size.height - panel.frame.size.height) / 2
			panel.setFrameOrigin(NSPoint(x: x, y: y))
		}
	}
}
