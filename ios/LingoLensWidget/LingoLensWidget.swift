import AppIntents
import SwiftUI
import WidgetKit

/// Widget settings (long-press the widget → Edit Widget).
struct WordConfigIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Từ vựng"
    static var description = IntentDescription("Một từ đã lưu, đổi mỗi giờ.")

    /// Put several widgets in a Stack and give each a different number: swiping the stack shows the next word at once.
    @Parameter(title: "Từ thứ (khi xếp chồng nhiều widget)", default: 0)
    var offset: Int

    /// Only needed when the widget cannot read the app's words itself (no App Group): paste the list copied by the app.
    @Parameter(title: "Danh sách từ (chỉ khi widget không tự đọc được)", default: "")
    var pasted: String
}

/// "Next word" button: skips one word right away, without waiting for the next hour (iOS 17 interactive widget).
struct NextWordIntent: AppIntent {
    static var title: LocalizedStringResource = "Từ tiếp theo"

    func perform() async throws -> some IntentResult {
        WordSkip.advance()
        return .result()
    }
}

/// How many words the button has skipped (kept by the widget itself).
enum WordSkip {
    private static let key = "lingolens.wordSkip"
    static var value: Int { UserDefaults.standard.integer(forKey: key) }
    static func advance() { UserDefaults.standard.set(value + 1, forKey: key) }
}

struct WordEntry: TimelineEntry {
    let date: Date
    let word: WidgetWord?
    let note: String
}

struct Provider: AppIntentTimelineProvider {
    typealias Entry = WordEntry
    typealias Intent = WordConfigIntent

    func placeholder(in context: Context) -> WordEntry {
        WordEntry(date: Date(), word: WidgetWord(w: "destroy", ipa: "/dɪˈstrɔɪ/", vi: "phá hủy, tiêu diệt", p: "động từ"), note: "")
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
        // 1) the words the app wrote (App Group: updates by itself); 2) the pasted list
        if let snap = WidgetShared.read(), !snap.words.isEmpty {
            words = snap.words
        } else {
            words = WidgetShared.parsePasted(configuration.pasted)
        }
        if words.isEmpty {
            let note = "Chưa có từ.\nGiữ widget → Chỉnh sửa widget → dán danh sách (LingoLens → Trang chủ → Chép danh sách cho widget)."
            return [WordEntry(date: start, word: nil, note: note)]
        }
        let shift = WordSkip.value + configuration.offset
        return (0..<count).map { i -> WordEntry in
            let date = start.addingTimeInterval(Double(i) * 3600)
            let hour = Int(date.timeIntervalSince1970 / 3600)
            let day = hour / 24
            let order = Provider.dailyOrder(count: words.count, day: day)
            let slot = (((hour + shift) % words.count) + words.count) % words.count
            return WordEntry(date: date, word: words[order[slot]], note: "")
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
            default:
                card(word)
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

    /// The word, its pronunciation and part of speech, and the meaning. Nothing else.
    private func card(_ word: WidgetWord) -> some View {
        let small = family == .systemSmall
        return VStack(alignment: .leading, spacing: 4) {
            Text(word.w)
                .font(.system(size: small ? 24 : 30, weight: .bold))
                .foregroundColor(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            HStack(spacing: 6) {
                if let ipa = word.ipa, !ipa.isEmpty {
                    Text(ipa).font(.system(size: 13)).foregroundColor(widgetAccent).lineLimit(1)
                }
                if let p = word.p, !p.isEmpty {
                    Text(p)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(widgetMuted)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Color.white.opacity(0.1)))
                        .lineLimit(1)
                }
            }
            Text(word.vi)
                .font(.system(size: small ? 15 : 19, weight: .medium))
                .foregroundColor(.white)
                .lineLimit(3)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottomTrailing) {
            // the next word at once (no waiting for the next hour)
            Button(intent: NextWordIntent()) {
                Image(systemName: "arrow.right.circle.fill").font(.system(size: 24)).foregroundColor(widgetAccent)
            }
            .buttonStyle(.plain)
        }
    }
}

struct LingoLensWordWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "LingoLensWord", intent: WordConfigIntent.self, provider: Provider()) { entry in
            WordWidgetView(entry: entry)
        }
        .configurationDisplayName("Từ vựng")
        .description("Một từ đã lưu, đổi mỗi giờ. Bấm mũi tên để sang từ khác ngay.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}

@main
struct LingoLensWidgets: WidgetBundle {
    var body: some Widget {
        LingoLensWordWidget()
    }
}
