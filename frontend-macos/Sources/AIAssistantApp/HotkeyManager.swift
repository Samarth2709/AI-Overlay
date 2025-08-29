import AppKit
import Carbon

/**
 * Global Hotkey Manager
 * 
 * Manages registration and handling of global keyboard shortcuts using the Carbon Event Manager.
 * This allows the app to respond to hotkeys even when it's not the active application.
 * By default, it registers Option + Space to toggle the chat overlay.
 */
final class HotkeyManager {
	/// Reference to the registered hot key
	private var hotKeyRef: EventHotKeyRef?
	/// Reference to the event handler for hot key events
	private var eventHandlerRef: EventHandlerRef?
	/// Callback function to execute when the hotkey is pressed
	private let onInvoke: () -> Void

	/**
	 * Initializes the hotkey manager with a callback function
	 * 
	 * - Parameter onInvoke: Function to call when the registered hotkey is pressed
	 */
	init(onInvoke: @escaping () -> Void) {
		self.onInvoke = onInvoke
	}

	/**
	 * Cleanup when the manager is deallocated
	 * Automatically unregisters any active hotkeys and event handlers
	 */
	deinit {
		unregister()
	}

	/**
	 * Registers the default hotkey combination (Option + Space)
	 * This is the primary way to show/hide the chat overlay from anywhere in the system
	 */
	func registerDefaultHotkey() {
		// Space key (virtual key code 49) with Option modifier
		register(keyCode: UInt32(kVK_Space), modifiers: UInt32(optionKey))
	}

	/**
	 * Registers a custom hotkey with specified key code and modifiers
	 * 
	 * - Parameter keyCode: Virtual key code for the key (e.g., kVK_Space for space bar)
	 * - Parameter modifiers: Modifier flags (e.g., optionKey, commandKey, controlKey)
	 */
	func register(keyCode: UInt32, modifiers: UInt32) {
		// Clean up any existing registration first
		unregister()

		// Define the event type we want to handle (hot key pressed)
		var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
		
		// Create callback function that will be invoked when the hotkey is pressed
		let callback: EventHandlerUPP = { (_, _, userData) -> OSStatus in
			// Extract the HotkeyManager instance from the user data pointer
			let managerPointer = UnsafeMutableRawPointer(userData)
			let manager = Unmanaged<HotkeyManager>.fromOpaque(managerPointer!).takeUnretainedValue()
			// Execute the callback function
			manager.onInvoke()
			return noErr
		}

		// Install the event handler for hotkey events
		let managerPtr = Unmanaged.passUnretained(self).toOpaque()
		InstallEventHandler(GetApplicationEventTarget(), callback, 1, &eventType, managerPtr, &eventHandlerRef)

		// Register the actual hotkey with the system
		var hotKeyRef: EventHotKeyRef?
		let hotKeyID = EventHotKeyID(signature: OSType(FOUR_CHAR_CODE("AIAI")), id: 1)
		RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef)
		self.hotKeyRef = hotKeyRef
	}

	/**
	 * Unregisters the current hotkey and removes event handlers
	 * Called automatically during cleanup or when registering a new hotkey
	 */
	func unregister() {
		// Unregister the hotkey from the system
		if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
		// Remove the event handler
		if let eventHandlerRef { RemoveEventHandler(eventHandlerRef) }
		// Clear references
		hotKeyRef = nil
		eventHandlerRef = nil
	}
}

/**
 * Utility function to create a four-character code from a string
 * Used to create unique identifiers for hotkey registration
 * 
 * - Parameter code: 4-character string to convert (e.g., "AIAI")
 * - Returns: UInt32 representation of the four-character code
 */
private func FOUR_CHAR_CODE(_ code: String) -> UInt32 {
	var result: UInt32 = 0
	for char in code.utf16 {
		result = (result << 8) + UInt32(char)
	}
	return result
}
