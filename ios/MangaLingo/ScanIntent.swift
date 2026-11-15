import AppIntents
import Foundation

/// Shortcuts action “Quét ảnh với LingoLens”: receives an image (e.g. from “Take Screenshot”),
/// opens LingoLens and shows it on the scan screen. Used with the iPhone's AssistiveTouch button:
/// AssistiveTouch → Shortcut [Take Screenshot → Quét ảnh với LingoLens].
struct ScanScreenshotIntent: AppIntent {
    static var title: LocalizedStringResource = "Quét ảnh với LingoLens"
    static var description = IntentDescription("Mở LingoLens với ảnh (ví dụ ảnh chụp màn hình) để chọn vùng, quét chữ và tra nghĩa.")
    static var openAppWhenRun: Bool = true

    /// Connected automatically to the result of the action above it (e.g. "Take Screenshot"), so the
    /// user never has to pick a variable – tapping a file parameter would open the Files app instead.
    @Parameter(title: "Ảnh", supportedTypeIdentifiers: ["public.image"], inputConnectionBehavior: .connectToPreviousIntentResult)
    var image: IntentFile

    static var parameterSummary: some ParameterSummary {
        Summary("Quét \(\.$image) với LingoLens")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        try PendingScan.save(image.data)
        NotificationCenter.default.post(name: .mlNewScan, object: nil)
        return .result()
    }
}
