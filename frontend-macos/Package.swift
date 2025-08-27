// swift-tools-version: 5.9
import PackageDescription

let package = Package(
	name: "AIAssistantApp",
	platforms: [
		.macOS(.v13)
	],
	products: [
		.executable(name: "AIAssistantApp", targets: ["AIAssistantApp"])
	],
	targets: [
		.executableTarget(
			name: "AIAssistantApp",
			path: "Sources/AIAssistantApp",
			resources: [.copy("fonts")]
		)
	]
)
