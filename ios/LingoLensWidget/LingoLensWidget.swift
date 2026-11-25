import AppIntents
import SwiftUI
import WidgetKit

/// Widget settings (long-press the widget → Edit Widget).
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

/// The last list read from GitHub, kept for when the phone is offline.
enum WidgetCache {
    private static var url: URL? {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?.appendingPathComponent("widget-cloud-words.json")
    }

    static func save(_ snapshot: WidgetSnapshot) {
        if let u = url, let d = try? JSONEncoder().encode(snapshot) { try? d.write(to: u, options: .atomic) }
    }

    static func load() -> WidgetSnapshot? {
        guard let u = url, let d = try? Data(contentsOf: u) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: d)
    }
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
        // the widget gallery shows a sample word, not the empty state
        if context.isPreview { return placeholder(in: context) }
        let loaded = await loadWords(for: configuration)
        return makeEntries(words: loaded.words, note: loaded.note, shift: shift(configuration), from: Date(), count: 1).first ?? placeholder(in: context)
    }

    /// 24 entries, one per hour: the word changes every hour even if iOS does not refresh the widget in between. With the GitHub sync the
    /// list is read again every few hours (and at once when the app saves a word and asks for a reload).
    func timeline(for configuration: WordConfigIntent, in context: Context) async -> Timeline<WordEntry> {
        let loaded = await loadWords(for: configuration)
        let start = Calendar.current.dateInterval(of: .hour, for: Date())?.start ?? Date()
        let entries = makeEntries(words: loaded.words, note: loaded.note, shift: shift(configuration), from: start, count: 24)
        let policy: TimelineReloadPolicy = loaded.cloud ? .after(Date().addingTimeInterval(3 * 3600)) : .atEnd
        return Timeline(entries: entries, policy: policy)
    }

    private func shift(_ configuration: WordConfigIntent) -> Int { WordSkip.value + configuration.offset }

    /// Where the words come from: 1) the App Group file, 2) the encrypted list on GitHub (sync code), 3) the pasted list.
    private func loadWords(for configuration: WordConfigIntent) async -> (words: [WidgetWord], note: String, cloud: Bool) {
        if let snap = WidgetShared.read(), !snap.words.isEmpty { return (snap.words, "", false) }
        var note = ""
        var usesCloud = false
        let code = configuration.code.trimmingCharacters(in: .whitespacesAndNewlines)
        if let parsed = WidgetSyncCode.parse(code) {
            usesCloud = true
            do {
                let snap = try await WidgetCloud.fetch(parsed)
                WidgetCache.save(snap)
                if !snap.words.isEmpty { return (snap.words, "", true) }
            } catch {
                if let cached = WidgetCache.load(), !cached.words.isEmpty { return (cached.words, "", true) }
                note = (error as? WidgetCloudError)?.description ?? "Không tải được từ GitHub."
            }
        } else if !code.isEmpty {
            note = "Mã đồng bộ không đúng. Chép lại từ LingoLens → Trang chủ → Widget từ vựng."
        }
        let pasted = WidgetShared.parsePasted(configuration.pasted)
        if !pasted.isEmpty { return (pasted, "", usesCloud) }
        if note.isEmpty {
            note = "Chưa có từ.\nGiữ widget → Chỉnh sửa widget → dán Mã đồng bộ (LingoLens → Trang chủ → Widget từ vựng)."
        }
        return ([], note, usesCloud)
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

    private func makeEntries(words: [WidgetWord], note: String, shift: Int, from start: Date, count: Int) -> [WordEntry] {
        if words.isEmpty { return [WordEntry(date: start, word: nil, note: note)] }
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
