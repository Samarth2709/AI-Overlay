import AppKit
import Carbon

final class HotkeyManager {
	private var hotKeyRef: EventHotKeyRef?
	private var eventHandlerRef: EventHandlerRef?
	private let onInvoke: () -> Void

	init(onInvoke: @escaping () -> Void) {
		self.onInvoke = onInvoke
	}

	deinit {
		unregister()
	}

	func registerDefaultHotkey() {
		// Default: Option + Space (kVK_Space = 49)
		register(keyCode: UInt32(kVK_Space), modifiers: UInt32(optionKey))
	}

	func register(keyCode: UInt32, modifiers: UInt32) {
		unregister()

		var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
		let callback: EventHandlerUPP = { (_, _, userData) -> OSStatus in
			let managerPointer = UnsafeMutableRawPointer(userData)
			let manager = Unmanaged<HotkeyManager>.fromOpaque(managerPointer!).takeUnretainedValue()
			manager.onInvoke()
			return noErr
		}

		let managerPtr = Unmanaged.passUnretained(self).toOpaque()
		InstallEventHandler(GetApplicationEventTarget(), callback, 1, &eventType, managerPtr, &eventHandlerRef)

		var hotKeyRef: EventHotKeyRef?
		let hotKeyID = EventHotKeyID(signature: OSType(FOUR_CHAR_CODE("AIAI")), id: 1)
		RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &hotKeyRef)
		self.hotKeyRef = hotKeyRef
	}

	func unregister() {
		if let hotKeyRef { UnregisterEventHotKey(hotKeyRef) }
		if let eventHandlerRef { RemoveEventHandler(eventHandlerRef) }
		hotKeyRef = nil
		eventHandlerRef = nil
	}
}

private func FOUR_CHAR_CODE(_ code: String) -> UInt32 {
	var result: UInt32 = 0
	for char in code.utf16 {
		result = (result << 8) + UInt32(char)
	}
	return result
}
