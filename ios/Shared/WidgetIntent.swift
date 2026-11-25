import AppIntents

/// Widget settings (long-press the widget → Edit Widget). Shared by the widget and the app: the app reads the widget's settings back
/// (WidgetCenter.getCurrentConfigurations) to tell the user whether the sync code was pasted correctly.
@available(iOS 17.0, *)
struct WordConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Từ vựng"
    static var description = IntentDescription("Một từ đã lưu, đổi mỗi giờ.")

    /// Paste ONCE the sync code copied from the app (LingoLens → Trang chủ → Widget từ vựng): the widget then follows the saved words by itself.
    @Parameter(title: "Mã đồng bộ (dán một lần)", default: "")
    var code: String

    /// Put several widgets in a Stack and give each a different number: swiping the stack shows the next word at once.
    @Parameter(title: "Từ thứ (khi xếp chồng nhiều widget)", default: 0)
    var offset: Int

    /// Fallback without any sync: paste the list copied by the app.
    @Parameter(title: "Danh sách từ (cách dự phòng)", default: "")
    var pasted: String
}
