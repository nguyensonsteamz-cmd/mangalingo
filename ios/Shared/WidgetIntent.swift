import AppIntents

/// Looks of the Home Screen widget (the lock-screen widgets have no background). Every theme keeps its text clearly readable:
/// light backgrounds use near-black text, dark/coloured ones use white text.
@available(iOS 17.0, *)
enum WidgetTheme: String, AppEnum {
    case app, white, dark, blue, green, pink, orange, sunset, ocean, aurora, glassLight, glassDark

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Giao diện"
    static var caseDisplayRepresentations: [WidgetTheme: DisplayRepresentation] = [
        .app: "Theo cài đặt trong app",
        .white: "Trắng",
        .dark: "Tối",
        .blue: "Xanh dương",
        .green: "Xanh lá",
        .pink: "Hồng",
        .orange: "Cam",
        .sunset: "Hoàng hôn",
        .ocean: "Đại dương",
        .aurora: "Màu loang (cực quang)",
        .glassLight: "Kính mờ sáng",
        .glassDark: "Kính mờ tối",
    ]
}

/// How often the widget changes the word.
@available(iOS 17.0, *)
enum WidgetInterval: String, AppEnum {
    case app, m15, m30, h1, h2, h3, h6, h12, h24

    var minutes: Int? {
        switch self {
        case .app: return nil
        case .m15: return 15
        case .m30: return 30
        case .h1: return 60
        case .h2: return 120
        case .h3: return 180
        case .h6: return 360
        case .h12: return 720
        case .h24: return 1440
        }
    }

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Tần suất đổi từ"
    static var caseDisplayRepresentations: [WidgetInterval: DisplayRepresentation] = [
        .app: "Theo cài đặt trong app",
        .m15: "15 phút",
        .m30: "30 phút",
        .h1: "1 giờ",
        .h2: "2 giờ",
        .h3: "3 giờ",
        .h6: "6 giờ",
        .h12: "12 giờ",
        .h24: "1 ngày",
    ]
}

/// How the widget walks through the saved words every hour.
@available(iOS 17.0, *)
enum WidgetOrder: String, AppEnum {
    case app, random, sequential

    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Thứ tự từ"
    static var caseDisplayRepresentations: [WidgetOrder: DisplayRepresentation] = [
        .app: "Theo cài đặt trong app",
        .random: "Ngẫu nhiên",
        .sequential: "Theo thứ tự trong sổ từ",
    ]
}

/// Widget settings (long-press the widget → Edit Widget). Shared by the widget and the app: the app reads the widget's settings back
/// (WidgetCenter.getCurrentConfigurations) to tell the user whether the sync code was pasted correctly.
@available(iOS 17.0, *)
struct WordConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Từ vựng"
    static var description = IntentDescription("Một từ đã lưu, đổi mỗi giờ.")

    @Parameter(title: "Giao diện", default: .app)
    var theme: WidgetTheme

    @Parameter(title: "Tần suất đổi từ", default: .app)
    var interval: WidgetInterval

    @Parameter(title: "Thứ tự từ", default: .app)
    var order: WidgetOrder

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
