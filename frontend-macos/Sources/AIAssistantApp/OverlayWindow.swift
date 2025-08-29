import SwiftUI
import AppKit

/**
 * Overlay Window Manager
 * 
 * Manages a floating, translucent window that displays the AI chat interface.
 * The window appears as an overlay on top of all other applications and can be
 * toggled with a global hotkey. It features a modern glassmorphism design with
 * blur effects and smooth animations.
 */
final class OverlayWindow {
	/// Shared singleton instance
	static let shared = OverlayWindow()

	/// The NSPanel that contains the SwiftUI content
	private var panel: NSPanel?
	/// SwiftUI hosting view that renders the content
	private var hostingView: NSHostingView<AnyView>?
	/// Event monitor for ESC key to hide the window
	private var escMonitor: Any?
	
	/// Returns true if the overlay window is currently visible
	var isVisible: Bool {
		return panel?.isVisible ?? false
	}

	/**
	 * Initializes the overlay window if it hasn't been created yet
	 * 
	 * Creates an NSPanel with a glassmorphism effect and configures it to float
	 * above all other windows. The window is initially hidden and positioned
	 * in the top-right corner of the screen.
	 * 
	 * - Parameter rootView: The SwiftUI view to display in the window
	 */
	func initializeIfNeeded(rootView: AnyView) {
		guard panel == nil else { return }

		// Create the main panel with initial compact size
		let panel = NSPanel(
			contentRect: CGRect(x: 0, y: 0, width: 360, height: 60),
			styleMask: [.utilityWindow, .titled, .closable, .resizable],
			backing: .buffered,
			defer: false
		)
		
		// Configure panel appearance for overlay behavior
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

		// Create the visual effect view for glassmorphism appearance
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

		// Create hosting view for SwiftUI content
		let hosting = NSHostingView(rootView: rootView)
		hosting.translatesAutoresizingMaskIntoConstraints = false
		effect.addSubview(hosting)

		// Set up auto layout constraints to fill the effect view
		NSLayoutConstraint.activate([
			hosting.leadingAnchor.constraint(equalTo: effect.leadingAnchor),
			hosting.trailingAnchor.constraint(equalTo: effect.trailingAnchor),
			hosting.topAnchor.constraint(equalTo: effect.topAnchor),
			hosting.bottomAnchor.constraint(equalTo: effect.bottomAnchor)
		])

		// Set the effect view as the panel's content
		panel.contentView = effect

		// Store references
		self.panel = panel
		self.hostingView = hosting

		// Position window and initially hide it
		positionInTopRight()
		hide()
	}

	/**
	 * Shows the overlay window with a smooth fade-in animation
	 * 
	 * Positions the window in the top-right corner, activates the app,
	 * and sets up ESC key monitoring for quick dismissal.
	 */
	func show() {
		guard let panel else { return }
		
		// Update position in case screen resolution changed
		positionInTopRight()
		
		// Set up ESC key monitoring to hide the window
		if escMonitor == nil {
			escMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
				if event.keyCode == 53 { // ESC key
					self?.hide()
					return nil // Consume the event
				}
				return event
			}
		}
		
		// Activate the app and bring the panel to front
		NSApp.activate(ignoringOtherApps: true)
		
		// Start with transparent panel for smooth fade-in
		panel.alphaValue = 0
		panel.makeKeyAndOrderFront(nil)
		
		// Animate fade-in effect
		NSAnimationContext.runAnimationGroup({ context in
			context.duration = 0.15
			context.timingFunction = CAMediaTimingFunction(name: .easeOut)
			panel.animator().alphaValue = 1.0
		})
		
		// Ensure the panel can accept keyboard input
		DispatchQueue.main.async {
			panel.makeKey()
			panel.makeFirstResponder(panel.contentView)
		}
	}

	/**
	 * Hides the overlay window with a smooth fade-out animation
	 * 
	 * Animates the window's alpha to 0, then removes it from screen.
	 * Also removes the ESC key monitor.
	 */
	func hide() {
		guard let panel else { return }
		
		// Animate fade-out effect
		NSAnimationContext.runAnimationGroup({ context in
			context.duration = 0.1
			context.timingFunction = CAMediaTimingFunction(name: .easeIn)
			panel.animator().alphaValue = 0.0
		}) {
			// Hide the window after animation completes
			panel.orderOut(nil)
		}
		
		// Remove ESC key monitoring
		if let escMonitor { NSEvent.removeMonitor(escMonitor) }
		escMonitor = nil
	}

	/**
	 * Toggles the visibility of the overlay window
	 * Shows if hidden, hides if visible
	 */
	func toggle() {
		guard let panel else { return }
		if panel.isVisible { hide() } else { show() }
	}

	/**
	 * Positions the window in the top-right corner of the main screen
	 * 
	 * Calculates the position based on the current screen size and window dimensions,
	 * maintaining a consistent margin from the screen edges.
	 */
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
	
	/**
	 * Updates the size of the overlay window with optional animation
	 * 
	 * Intelligently handles window positioning - if the window is in its default
	 * top-right position, it maintains that position while resizing. If the user
	 * has moved the window, it resizes in place.
	 * 
	 * - Parameter width: New width for the window
	 * - Parameter height: New height for the window  
	 * - Parameter animated: Whether to animate the size change (default: true)
	 */
	func updateSize(width: CGFloat, height: CGFloat, animated: Bool = true) {
		guard let panel else { return }
		
		let newSize = NSSize(width: width, height: height)
		
		// Determine if we should maintain auto-positioning or resize in place
		if let screen = NSScreen.main {
			let rect = screen.visibleFrame
			let margin: CGFloat = 20
			let defaultX = rect.origin.x + rect.size.width - panel.frame.size.width - margin
			let defaultY = rect.origin.y + rect.size.height - panel.frame.size.height - margin
			let currentFrame = panel.frame
			
			// Check if window is still in its default position (within 50px tolerance)
			let isNearDefault = abs(currentFrame.origin.x - defaultX) < 50 && abs(currentFrame.origin.y - defaultY) < 50
			
			if isNearDefault {
				// Maintain top-right positioning while resizing
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
				// User has moved the window, resize in place without changing position
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
