import AppIntents
import SwiftUI
import WidgetKit

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
    private static let tapKey = "lingolens.lastTap"
    static var value: Int { UserDefaults.standard.integer(forKey: key) }

    static func advance() {
        UserDefaults.standard.set(value + 1, forKey: key)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: tapKey)
    }

    /// The widget is being refreshed because the button was just pressed: the list is already known, so the next word must appear at once
    /// (asking the network first made the button feel slow).
    static var tappedJustNow: Bool { Date().timeIntervalSince1970 - UserDefaults.standard.double(forKey: tapKey) < 5 }
}

/// What the user typed into any widget, kept for every widget of LingoLens (the widget extension's own storage, shared by its widgets).
enum WidgetMemory {
    private static let codeKey = "lingolens.syncCode"
    private static let listKey = "lingolens.pastedList"

    static var syncCode: String {
        get { UserDefaults.standard.string(forKey: codeKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: codeKey) }
    }

    static var pastedList: String {
        get { UserDefaults.standard.string(forKey: listKey) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: listKey) }
    }
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
        // The code is pasted into ONE widget but remembered for all of them (the lock-screen widgets are separate widgets and would
        // otherwise each ask for it again). A newly pasted valid code replaces the remembered one.
        let typed = configuration.code.trimmingCharacters(in: .whitespacesAndNewlines)
        if WidgetSyncCode.parse(typed) != nil { WidgetMemory.syncCode = typed }
        let code = typed.isEmpty ? WidgetMemory.syncCode : typed
        if let parsed = WidgetSyncCode.parse(code) {
            usesCloud = true
            // the button was just pressed: show the next word from the list we already have, without waiting for the network
            if WordSkip.tappedJustNow, let cached = WidgetCache.load(), !cached.words.isEmpty { return (cached.words, "", true) }
            do {
                // a short wait: with a cached list a slow network must not hold the widget back
                let snap = try await WidgetCloud.fetch(parsed, timeout: WidgetCache.load() == nil ? 15 : 6)
                WidgetCache.save(snap)
                if !snap.words.isEmpty { return (snap.words, "", true) }
            } catch {
                if let cached = WidgetCache.load(), !cached.words.isEmpty { return (cached.words, "", true) }
                note = (error as? WidgetCloudError)?.description ?? "Không tải được từ GitHub."
            }
        } else if !code.isEmpty {
            note = "Mã đồng bộ không đúng. Chép lại từ LingoLens → Trang chủ → Widget từ vựng."
        }
        let typedList = configuration.pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        if !WidgetShared.parsePasted(typedList).isEmpty { WidgetMemory.pastedList = typedList }
        let pasted = WidgetShared.parsePasted(typedList.isEmpty ? WidgetMemory.pastedList : typedList)
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

// Home Screen widgets are white (easy to read); lock-screen widgets have no background at all, only text (the system tints them).
private let widgetInk = Color(red: 17 / 255, green: 24 / 255, blue: 39 / 255)
private let widgetAccent = Color(red: 52 / 255, green: 81 / 255, blue: 209 / 255)
private let widgetMuted = Color(red: 107 / 255, green: 114 / 255, blue: 128 / 255)

struct WordWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: WordEntry

    private var isLockScreen: Bool { family == .accessoryInline || family == .accessoryRectangular || family == .accessoryCircular }

    var body: some View {
        if isLockScreen {
            content.containerBackground(Color.clear, for: .widget)
        } else {
            content.containerBackground(Color.white, for: .widget)
        }
    }

    @ViewBuilder
    private var content: some View {
        if let word = entry.word {
            switch family {
            case .accessoryInline:
                Text("\(word.w): \(word.vi)")
            case .accessoryRectangular:
                // text only: word + pronunciation, then part of speech and meaning
                VStack(alignment: .leading, spacing: 1) {
                    Text([word.w, word.ipa ?? ""].filter { !$0.isEmpty }.joined(separator: "  ")).font(.headline).lineLimit(1).minimumScaleFactor(0.6)
                    Text([word.p ?? "", word.vi].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).lineLimit(2).minimumScaleFactor(0.7)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            case .accessoryCircular:
                Text(word.w).font(.caption).lineLimit(2).minimumScaleFactor(0.5)
            default:
                card(word)
            }
        } else if isLockScreen {
            Text("Mở LingoLens").font(.caption)
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

    /// One colour per part of speech (the label is the Vietnamese one the app sends: "danh từ", "động từ"…).
    private func posColor(_ label: String) -> Color {
        let l = label.lowercased()
        if l.contains("danh từ") { return Color(red: 37 / 255, green: 99 / 255, blue: 235 / 255) } // noun: blue
        if l.contains("động từ") { return Color(red: 22 / 255, green: 163 / 255, blue: 74 / 255) } // verb (incl. auxiliary, modal): green
        if l.contains("tính từ") { return Color(red: 234 / 255, green: 88 / 255, blue: 12 / 255) } // adjective: orange
        if l.contains("trạng từ") { return Color(red: 147 / 255, green: 51 / 255, blue: 234 / 255) } // adverb: purple
        if l.contains("đại từ") { return Color(red: 219 / 255, green: 39 / 255, blue: 119 / 255) } // pronoun: pink
        if l.contains("giới từ") { return Color(red: 13 / 255, green: 148 / 255, blue: 136 / 255) } // preposition: teal
        if l.contains("liên từ") { return Color(red: 202 / 255, green: 138 / 255, blue: 4 / 255) } // conjunction: amber
        if l.contains("thán từ") { return Color(red: 220 / 255, green: 38 / 255, blue: 38 / 255) } // interjection: red
        if l.contains("số từ") { return Color(red: 8 / 255, green: 145 / 255, blue: 178 / 255) } // numeral: cyan
        return widgetMuted
    }

    /// Row 1: the word and, on the SAME line, its pronunciation. Row 2: the part of speech (coloured by kind). Row 3: the meaning on its
    /// own line, big. Every text shrinks to fit the widget instead of being cut.
    private func card(_ word: WidgetWord) -> some View {
        let small = family == .systemSmall
        return VStack(alignment: .leading, spacing: small ? 4 : 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(word.w)
                    .font(.system(size: small ? 26 : 34, weight: .bold))
                    .foregroundColor(widgetInk)
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
                    .layoutPriority(2)
                if let ipa = word.ipa, !ipa.isEmpty {
                    Text(ipa)
                        .font(.system(size: small ? 14 : 18))
                        .foregroundColor(widgetAccent)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .layoutPriority(1)
                }
            }
            HStack(spacing: 6) {
                if let p = word.p, !p.isEmpty {
                    let c = posColor(p)
                    Text(p)
                        .font(.system(size: small ? 11 : 13, weight: .bold))
                        .foregroundColor(c)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(c.opacity(0.14)))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                // the next word at once (no waiting for the next hour)
                Button(intent: NextWordIntent()) {
                    Image(systemName: "arrow.right.circle.fill").font(.system(size: small ? 24 : 28)).foregroundColor(widgetAccent)
                }
                .buttonStyle(.plain)
            }
            Text(word.vi)
                .font(.system(size: small ? 20 : 28, weight: .semibold))
                .foregroundColor(widgetInk)
                .lineLimit(3)
                .minimumScaleFactor(0.4)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct LingoLensWordWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "LingoLensWord", intent: WordConfigIntent.self, provider: Provider()) { entry in
            WordWidgetView(entry: entry)
        }
        .configurationDisplayName("Từ vựng")
        .description("Một từ đã lưu, đổi mỗi giờ. Bấm mũi tên để sang từ khác ngay.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline, .accessoryCircular])
    }
}

@main
struct LingoLensWidgets: WidgetBundle {
    var body: some Widget {
        LingoLensWordWidget()
    }
}
