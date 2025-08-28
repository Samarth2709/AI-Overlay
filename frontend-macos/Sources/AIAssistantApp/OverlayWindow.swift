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
			contentRect: CGRect(x: 0, y: 0, width: 360, height: 60),
			styleMask: [.utilityWindow, .titled, .closable, .resizable],
			backing: .buffered,
			defer: false
		)
		panel.titleVisibility = .hidden
		panel.titlebarAppearsTransparent = true
		panel.isFloatingPanel = true
		panel.hidesOnDeactivate = false
		panel.level = .floating
		panel.hasShadow = false
		panel.isOpaque = false
		panel.backgroundColor = .clear
		panel.collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace]
		panel.isMovableByWindowBackground = true
		panel.animationBehavior = .none

		let effect = NSVisualEffectView()
		effect.material = .popover
		effect.blendingMode = .withinWindow
		effect.state = .active
		effect.translatesAutoresizingMaskIntoConstraints = false
		effect.wantsLayer = true
		effect.layer?.cornerRadius = 12
		effect.layer?.masksToBounds = true
		effect.layer?.borderWidth = 0.5
		effect.layer?.borderColor = NSColor.white.withAlphaComponent(0.04).cgColor

		let hosting = NSHostingView(rootView: rootView)
		hosting.translatesAutoresizingMaskIntoConstraints = false
		effect.addSubview(hosting)

		NSLayoutConstraint.activate([
			hosting.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
			hosting.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
			hosting.topAnchor.constraint(equalTo: effect.topAnchor),
			hosting.bottomAnchor.constraint(equalTo: effect.bottomAnchor)
		])

		panel.contentView = effect

		self.panel = panel
		self.hostingView = hosting

		positionInTopRight()
		hide()
	}

	func show() {
		guard let panel else { return }
		positionInTopRight()
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
		
		// Smooth fade in animation
		panel.alphaValue = 0
		panel.makeKeyAndOrderFront(nil)
		
		NSAnimationContext.runAnimationGroup({ context in
			context.duration = 0.15
			context.timingFunction = CAMediaTimingFunction(name: .easeOut)
			panel.animator().alphaValue = 1.0
		})
		
		// Ensure the panel becomes the key window and can accept text input
		DispatchQueue.main.async {
			panel.makeKey()
			panel.makeFirstResponder(panel.contentView)
		}
	}

	func hide() {
		guard let panel else { return }
		
		NSAnimationContext.runAnimationGroup({ context in
			context.duration = 0.1
			context.timingFunction = CAMediaTimingFunction(name: .easeIn)
			panel.animator().alphaValue = 0.0
		}) {
			panel.orderOut(nil)
		}
		
		if let escMonitor { NSEvent.removeMonitor(escMonitor) }
		escMonitor = nil
	}

	func toggle() {
		guard let panel else { return }
		if panel.isVisible { hide() } else { show() }
	}

	private func positionInTopRight() {
		guard let panel else { return }
		if let screen = NSScreen.main {
			let rect = screen.visibleFrame
			let margin: CGFloat = 20
			let x = rect.origin.x + rect.size.width - panel.frame.size.width - margin
			let y = rect.origin.y + rect.size.height - panel.frame.size.height - margin
			panel.setFrameOrigin(NSPoint(x: x, y: y))
		}
	}
	
	func updateSize(width: CGFloat, height: CGFloat, animated: Bool = true) {
		guard let panel else { return }
		
		let newSize = NSSize(width: width, height: height)
		
		// Only auto-position if window hasn't been moved by user
		// Check if current position is close to default top-right position
		if let screen = NSScreen.main {
			let rect = screen.visibleFrame
			let margin: CGFloat = 20
			let defaultX = rect.origin.x + rect.size.width - panel.frame.size.width - margin
			let defaultY = rect.origin.y + rect.size.height - panel.frame.size.height - margin
			let currentFrame = panel.frame
			
			// If window is near default position (within 50px), maintain auto-positioning
			let isNearDefault = abs(currentFrame.origin.x - defaultX) < 50 && abs(currentFrame.origin.y - defaultY) < 50
			
			if isNearDefault {
				let newX = rect.origin.x + rect.size.width - width - margin
				let newY = rect.origin.y + rect.size.height - height - margin
				let newFrame = NSRect(origin: NSPoint(x: newX, y: newY), size: newSize)
				
				if animated {
					NSAnimationContext.runAnimationGroup { context in
						context.duration = 0.2
						context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
						panel.animator().setFrame(newFrame, display: true)
					}
				} else {
					panel.setFrame(newFrame, display: true)
				}
			} else {
				// User has moved the window, just resize in place
				let newFrame = NSRect(origin: currentFrame.origin, size: newSize)
				if animated {
					NSAnimationContext.runAnimationGroup { context in
						context.duration = 0.2
						context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
						panel.animator().setFrame(newFrame, display: true)
					}
				} else {
					panel.setFrame(newFrame, display: true)
				}
			}
		}
	}
}
