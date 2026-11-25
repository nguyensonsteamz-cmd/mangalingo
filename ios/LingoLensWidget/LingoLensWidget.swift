import AppIntents
import SwiftUI
import WidgetKit

/// Widget settings (long-press the widget → Edit Widget). The pasted list is the fallback when the widget cannot read the app's saved
/// words through an App Group (free Apple ID signing may not allow it): the app copies the list, you paste it here.
struct WordConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Danh sách từ"
    static var description = IntentDescription("Chỉ cần khi widget không tự đọc được sổ từ: dán danh sách chép từ ứng dụng LingoLens.")

    @Parameter(title: "Danh sách từ (dán vào đây)", default: "")
    var pasted: String
}

struct WordEntry: TimelineEntry {
    let date: Date
    let word: WidgetWord?
    /// where the word came from: "tự động" (App Group), "đã dán", or "" when nothing is available
    let source: String
    /// "3/48"
    let position: String
    let note: String
}

struct Provider: AppIntentTimelineProvider {
    typealias Entry = WordEntry
    typealias Intent = WordConfigIntent

    func placeholder(in context: Context) -> WordEntry {
        WordEntry(date: Date(), word: WidgetWord(w: "destroy", ipa: "/dɪˈstrɔɪ/", vi: "phá hủy, tiêu diệt", ex: "The village was destroyed."), source: "mẫu", position: "1/1", note: "")
    }

    func snapshot(for configuration: WordConfigIntent, in context: Context) async -> WordEntry {
        let first = entries(for: configuration, from: Date(), count: 1).first
        // the widget gallery shows a sample word, not the empty state
        if context.isPreview, first?.word == nil { return placeholder(in: context) }
        return first ?? placeholder(in: context)
    }

    /// 24 entries, one per hour: the word changes every hour even if iOS does not refresh the widget in between.
    func timeline(for configuration: WordConfigIntent, in context: Context) async -> Timeline<WordEntry> {
        let start = Calendar.current.dateInterval(of: .hour, for: Date())?.start ?? Date()
        return Timeline(entries: entries(for: configuration, from: start, count: 24), policy: .atEnd)
    }

    /// Indices 0..<count in an order that changes every day (so every word shows before one repeats).
    static func dailyOrder(count: Int, day: Int) -> [Int] {
        func key(_ i: Int) -> Int {
            let a: Int = i &* 2_654_435_761
            let b: Int = day &* 40_503
            return (a &+ b) & 0xFFFFF
        }
        return Array(0..<count).sorted { x, y in
            let kx = key(x)
            let ky = key(y)
            return kx == ky ? x < y : kx < ky
        }
    }

    private func entries(for configuration: WordConfigIntent, from start: Date, count: Int) -> [WordEntry] {
        var words: [WidgetWord] = []
        var source = ""
        var note = ""
        if let snap = WidgetShared.read(), !snap.words.isEmpty {
            words = snap.words
            source = "tự động"
        } else {
            let pasted = WidgetShared.parsePasted(configuration.pasted)
            if !pasted.isEmpty {
                words = pasted
                source = "đã dán"
            } else {
                note = "Chưa có danh sách từ.\nGiữ widget → Chỉnh sửa widget → dán danh sách (LingoLens → Trang chủ → Chép danh sách cho widget)."
            }
        }
        if words.isEmpty {
            return [WordEntry(date: start, word: nil, source: "", position: "", note: note)]
        }
        return (0..<count).map { i -> WordEntry in
            let date = start.addingTimeInterval(Double(i) * 3600)
            let hour = Int(date.timeIntervalSince1970 / 3600)
            let day = hour / 24
            // a different order every day (so every word shows before repeating), one step per hour
            let order = Provider.dailyOrder(count: words.count, day: day)
            let slot = hour % words.count
            return WordEntry(date: date, word: words[order[slot]], source: source, position: "\(slot + 1)/\(words.count)", note: note)
        }
    }
}

private let widgetBackground = Color(red: 16 / 255, green: 18 / 255, blue: 24 / 255)
private let widgetAccent = Color(red: 124 / 255, green: 156 / 255, blue: 255 / 255)
private let widgetMuted = Color(red: 154 / 255, green: 164 / 255, blue: 184 / 255)

struct WordWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WordEntry

    var body: some View {
        content.containerBackground(widgetBackground, for: .widget)
    }

    @ViewBuilder
    private var content: some View {
        if let word = entry.word {
            switch family {
            case .accessoryInline:
                Text("\(word.w): \(word.vi)")
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 2) {
                    Text(word.w).font(.headline).lineLimit(1)
                    Text(word.vi).font(.caption).lineLimit(2)
                }
            case .systemMedium:
                VStack(alignment: .leading, spacing: 4) {
                    header(word)
                    Text(word.vi).font(.system(size: 17, weight: .medium)).foregroundColor(.white).lineLimit(2)
                    if let ex = word.ex, !ex.isEmpty {
                        Text(ex).font(.system(size: 12)).italic().foregroundColor(widgetMuted).lineLimit(2)
                    }
                    Spacer(minLength: 0)
                    footer
                }
            default:
                VStack(alignment: .leading, spacing: 3) {
                    header(word)
                    Text(word.vi).font(.system(size: 14, weight: .medium)).foregroundColor(.white).lineLimit(3)
                    Spacer(minLength: 0)
                    footer
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("LingoLens").font(.headline).foregroundColor(widgetAccent)
                Text(entry.note.isEmpty ? "Lưu từ trong LingoLens để hiện ở đây." : entry.note)
                    .font(.system(size: 11))
                    .foregroundColor(widgetMuted)
                    .lineLimit(8)
            }
        }
    }

    private func header(_ word: WidgetWord) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(word.w).font(.system(size: family == .systemSmall ? 22 : 26, weight: .bold)).foregroundColor(.white).lineLimit(1).minimumScaleFactor(0.6)
            if let ipa = word.ipa, !ipa.isEmpty { Text(ipa).font(.system(size: 12)).foregroundColor(widgetAccent).lineLimit(1) }
        }
    }

    private var footer: some View {
        HStack {
            Text(entry.source).font(.system(size: 9)).foregroundColor(widgetMuted)
            Spacer()
            Text(entry.position).font(.system(size: 10, weight: .semibold)).foregroundColor(widgetMuted)
        }
    }
}

struct LingoLensWordWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "LingoLensWord", intent: WordConfigIntent.self, provider: Provider()) { entry in
            WordWidgetView(entry: entry)
        }
        .configurationDisplayName("Từ vựng")
        .description("Một từ đã lưu, đổi mỗi giờ.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct LingoLensWidgets: WidgetBundle {
    var body: some Widget {
        LingoLensWordWidget()
    }
}
