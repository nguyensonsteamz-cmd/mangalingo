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

/// "Previous word" button: goes one word back.
struct PrevWordIntent: AppIntent {
    static var title: LocalizedStringResource = "Từ trước"

    func perform() async throws -> some IntentResult {
        WordSkip.back()
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

    static func back() {
        UserDefaults.standard.set(value - 1, forKey: key)
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
    var theme: WidgetTheme = .white
}

struct Provider: AppIntentTimelineProvider {
    typealias Entry = WordEntry
    typealias Intent = WordConfigIntent

    func placeholder(in context: Context) -> WordEntry {
        WordEntry(date: Date(), word: WidgetWord(w: "destroy", ipa: "/dɪˈstrɔɪ/", vi: "phá hủy, tiêu diệt", p: "động từ"), note: "")
    }

    func snapshot(for configuration: WordConfigIntent, in context: Context) async -> WordEntry {
        // the widget gallery shows a sample word, not the empty state
        if context.isPreview {
            var sample = placeholder(in: context)
            sample.theme = .white
            return sample
        }
        let loaded = await loadWords(for: configuration)
        return makeEntries(words: loaded.words, note: loaded.note, shift: shift(configuration), from: Date(), count: 1, theme: resolveTheme(configuration, loaded.theme), sequential: sequential(configuration, loaded.order), stepMinutes: stepMinutes(configuration, loaded.interval)).first ?? placeholder(in: context)
    }

    /// 24 entries, one per hour: the word changes every hour even if iOS does not refresh the widget in between. With the GitHub sync the
    /// list is read again every few hours (and at once when the app saves a word and asks for a reload).
    func timeline(for configuration: WordConfigIntent, in context: Context) async -> Timeline<WordEntry> {
        let loaded = await loadWords(for: configuration)
        let minutes = stepMinutes(configuration, loaded.interval)
        let step = Double(minutes) * 60
        // the current slot, then enough slots for about two days (at most 96): the word keeps changing even if iOS does not refresh the widget
        let start = Date(timeIntervalSince1970: (Date().timeIntervalSince1970 / step).rounded(.down) * step)
        let count = min(96, max(6, Int(48 * 3600 / step)))
        let entries = makeEntries(words: loaded.words, note: loaded.note, shift: shift(configuration), from: start, count: count, theme: resolveTheme(configuration, loaded.theme), sequential: sequential(configuration, loaded.order), stepMinutes: minutes)
        let policy: TimelineReloadPolicy = loaded.cloud ? .after(Date().addingTimeInterval(3 * 3600)) : .atEnd
        return Timeline(entries: entries, policy: policy)
    }

    /// Follows the order chosen in the app (Cài đặt → Widget).
    private func sequential(_ configuration: WordConfigIntent, _ fromApp: String?) -> Bool {
        fromApp == "sequential"
    }

    /// "Theo cài đặt trong app" follows the theme chosen in LingoLens → Cài đặt → Widget.
    private func resolveTheme(_ configuration: WordConfigIntent, _ fromApp: String?) -> WidgetTheme {
        if let raw = fromApp, let t = WidgetTheme(rawValue: raw), t != .app { return t }
        return .white
    }

    /// Minutes between two words: the widget's own setting, or the app's ("Theo cài đặt trong app"), else 1 hour.
    private func stepMinutes(_ configuration: WordConfigIntent, _ fromApp: Int?) -> Int {
        if let m = fromApp, [15, 30, 60, 120, 180, 360, 720, 1440].contains(m) { return m }
        return 60
    }

    private func shift(_ configuration: WordConfigIntent) -> Int { WordSkip.value + configuration.offset }

    /// Where the words come from: 1) the App Group file, 2) the encrypted list on GitHub (sync code), 3) the pasted list.
    private func loadWords(for configuration: WordConfigIntent) async -> (words: [WidgetWord], note: String, cloud: Bool, order: String?, theme: String?, interval: Int?) {
        if let snap = WidgetShared.read(), !snap.words.isEmpty { return (snap.words, "", false, snap.order, snap.theme, snap.interval) }
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
            if WordSkip.tappedJustNow, let cached = WidgetCache.load(), !cached.words.isEmpty { return (cached.words, "", true, cached.order, cached.theme, cached.interval) }
            do {
                // a short wait: with a cached list a slow network must not hold the widget back
                let snap = try await WidgetCloud.fetch(parsed, timeout: WidgetCache.load() == nil ? 15 : 6)
                WidgetCache.save(snap)
                if !snap.words.isEmpty { return (snap.words, "", true, snap.order, snap.theme, snap.interval) }
            } catch {
                if let cached = WidgetCache.load(), !cached.words.isEmpty { return (cached.words, "", true, cached.order, cached.theme, cached.interval) }
                note = (error as? WidgetCloudError)?.description ?? "Không tải được từ GitHub."
            }
        } else if !code.isEmpty {
            note = "Mã đồng bộ không đúng. Chép lại từ LingoLens → Trang chủ → Widget từ vựng."
        }
        let typedList = configuration.pasted.trimmingCharacters(in: .whitespacesAndNewlines)
        if !WidgetShared.parsePasted(typedList).isEmpty { WidgetMemory.pastedList = typedList }
        let pasted = WidgetShared.parsePasted(typedList.isEmpty ? WidgetMemory.pastedList : typedList)
        if !pasted.isEmpty { return (pasted, "", usesCloud, nil, nil, nil) }
        if note.isEmpty {
            note = "Chưa có từ.\nGiữ widget → Chỉnh sửa widget → dán Mã đồng bộ (LingoLens → Trang chủ → Widget từ vựng)."
        }
        return ([], note, usesCloud, nil, nil, nil)
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

    private func makeEntries(words: [WidgetWord], note: String, shift: Int, from start: Date, count: Int, theme: WidgetTheme, sequential: Bool, stepMinutes: Int) -> [WordEntry] {
        if words.isEmpty { return [WordEntry(date: start, word: nil, note: note, theme: theme)] }
        return (0..<count).map { i -> WordEntry in
            let step = Double(stepMinutes) * 60
            let date = start.addingTimeInterval(Double(i) * step)
            let hour = Int(date.timeIntervalSince1970 / step) // the number of the time slot (a "slot" is one word)
            let day = Int(date.timeIntervalSince1970 / 86400)
            let order = sequential ? Array(0..<words.count) : Provider.dailyOrder(count: words.count, day: day)
            let slot = (((hour + shift) % words.count) + words.count) % words.count
            return WordEntry(date: date, word: words[order[slot]], note: "", theme: theme)
        }
    }
}

// Home Screen widgets are white (easy to read); lock-screen widgets have no background at all, only text (the system tints them).
private func hex(_ v: UInt32) -> Color {
    Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
}

/// Colours of one theme. Text is always far from the background in lightness (light background → near-black text, dark/coloured
/// background → white text), so it stays readable.
private struct Palette {
    let ink: Color // main text
    let accent: Color // pronunciation, arrow button
    let muted: Color // secondary text
    let onDark: Bool // dark background: part-of-speech tags become white pills
    var btnBG: Color { onDark ? .white : hex(0x111827) } // round buttons: always the opposite of the background
    var btnFG: Color { onDark ? hex(0x111827) : .white }
}

private extension WidgetTheme {
    var palette: Palette {
        switch self {
        case .white, .app: return Palette(ink: hex(0x111827), accent: hex(0x2F46C8), muted: hex(0x4B5563), onDark: false)
        case .glassLight: return Palette(ink: hex(0x0F172A), accent: hex(0x2F46C8), muted: hex(0x334155), onDark: false)
        case .dark: return Palette(ink: hex(0xFFFFFF), accent: hex(0x93C5FD), muted: hex(0xD1D5DB), onDark: true)
        case .orange, .sunset:
            // pronunciation in light cyan (amber would blend into these warm backgrounds)
            return Palette(ink: hex(0xFFFFFF), accent: hex(0xA5F3FC), muted: hex(0xE5E7EB), onDark: true)
        case .blue, .green, .pink, .ocean, .aurora, .glassDark:
            // pronunciation in light amber: clearly another colour than the white word and meaning
            return Palette(ink: hex(0xFFFFFF), accent: hex(0xFDE68A), muted: hex(0xE5E7EB), onDark: true)
        }
    }

    @ViewBuilder
    var background: some View {
        switch self {
        case .white, .app: Color.white
        case .dark: hex(0x111827)
        case .blue: LinearGradient(colors: [hex(0x1E3A8A), hex(0x2563EB)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .green: LinearGradient(colors: [hex(0x064E3B), hex(0x15803D)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .pink: LinearGradient(colors: [hex(0x831843), hex(0xBE185D)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .orange: LinearGradient(colors: [hex(0x7C2D12), hex(0xB45309)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .sunset: LinearGradient(colors: [hex(0x4C1D95), hex(0xBE185D), hex(0xB45309)], startPoint: .topLeading, endPoint: .bottomTrailing)
        case .ocean: LinearGradient(colors: [hex(0x0C4A6E), hex(0x0E7490), hex(0x115E59)], startPoint: .top, endPoint: .bottomTrailing)
        case .aurora:
            // blurred blobs of colour on a very dark base, darkened again so the white text stays clear
            ZStack {
                hex(0x0B1020)
                Circle().fill(hex(0x7C3AED)).frame(width: 170, height: 170).blur(radius: 40).offset(x: -60, y: -50)
                Circle().fill(hex(0x0891B2)).frame(width: 150, height: 150).blur(radius: 40).offset(x: 70, y: 10)
                Circle().fill(hex(0xDB2777)).frame(width: 140, height: 140).blur(radius: 40).offset(x: -20, y: 80)
                Color.black.opacity(0.35)
            }
        case .glassLight:
            // look-alike of frosted glass: pale colours with a white veil and a thin bright edge
            ZStack {
                LinearGradient(colors: [hex(0xDBEAFE), hex(0xFCE7F3)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Circle().fill(hex(0xA5B4FC).opacity(0.55)).frame(width: 140, height: 140).blur(radius: 30).offset(x: 60, y: -40)
                Color.white.opacity(0.4)
                ContainerRelativeShape().strokeBorder(Color.white.opacity(0.9), lineWidth: 1.5)
            }
        case .glassDark:
            ZStack {
                LinearGradient(colors: [hex(0x1E1B4B), hex(0x0F172A)], startPoint: .topLeading, endPoint: .bottomTrailing)
                Circle().fill(hex(0x6366F1).opacity(0.5)).frame(width: 140, height: 140).blur(radius: 30).offset(x: 60, y: -40)
                Color.white.opacity(0.08)
                ContainerRelativeShape().strokeBorder(Color.white.opacity(0.35), lineWidth: 1.5)
            }
        }
    }
}

struct WordWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    let entry: WordEntry

    private var isLockScreen: Bool { family == .accessoryInline || family == .accessoryRectangular || family == .accessoryCircular }

    var body: some View {
        if isLockScreen {
            content.containerBackground(Color.clear, for: .widget)
                .widgetURL(URL(string: "lingolens://vocab"))
        } else {
            content.containerBackground(for: .widget) { entry.theme.background }
                .widgetURL(URL(string: "lingolens://vocab"))
        }
    }

    private var pal: Palette { entry.theme.palette }

    @ViewBuilder
    private var content: some View {
        if let word = entry.word {
            switch family {
            case .accessoryInline:
                Text("\(word.w): \(word.vi)")
            case .accessoryRectangular:
                lockCard(word)
            case .accessoryCircular:
                Text(word.w)
                    .font(.system(size: 15, weight: .bold))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.4)
                    .padding(2)
            default:
                card(word)
            }
        } else if isLockScreen {
            Text("Mở LingoLens").font(.caption)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("LingoLens").font(.headline).foregroundColor(pal.accent)
                Text(entry.note.isEmpty ? "Lưu từ trong LingoLens để hiện ở đây." : entry.note)
                    .font(.system(size: 11))
                    .foregroundColor(pal.muted)
                    .lineLimit(8)
            }
        }
    }

    /// Lock-screen widget (no background, the system tints the text): the same layout as the Home Screen widget, with bigger text and
    /// no buttons. Row 1: the word or sentence. Row 2: pronunciation and part-of-speech tag, which the system draws in its accent tone
    /// (a different tone than the word and the meaning). Row 3: the meaning.
    private var fullColor: Bool { renderingMode == .fullColor }

    private func lockCard(_ word: WidgetWord) -> some View {
        let long = word.w.count > 24
        let hasTags = !(word.ipa ?? "").isEmpty || !(word.p ?? "").isEmpty
        return VStack(alignment: .leading, spacing: 1) {
            Text(word.w)
                .font(.system(size: long ? 14 : 19, weight: .bold))
                .lineLimit(long ? 2 : 1)
                .minimumScaleFactor(0.5)
                .multilineTextAlignment(.leading)
            if hasTags {
                HStack(spacing: 5) {
                    if let ipa = word.ipa, !ipa.isEmpty {
                        // full colour (StandBy): light amber like the Home Screen widget; on the lock screen (tinted by the system) a softer tone
                        Text(ipa)
                            .font(.system(size: 13))
                            .foregroundColor(fullColor ? hex(0xFDE68A) : Color.white.opacity(0.7))
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                    if let p = word.p, !p.isEmpty {
                        // full colour: the coloured tag of the Home Screen widget; tinted lock screen: a solid light pill with dark text
                        // (the system keeps only brightness there, so the tag stands out from the word and the meaning)
                        Text(p)
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundColor(fullColor ? hex(0x111827) : Color.black)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(fullColor ? posFillOnDark(p) : Color.white))
                    }
                }
                .widgetAccentable()
            }
            Text(word.vi)
                .font(.system(size: long ? 13 : 15, weight: .semibold))
                .lineLimit(long || !hasTags ? 2 : 1)
                .minimumScaleFactor(0.5)
                .multilineTextAlignment(.leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    /// One colour per part of speech (the label is the Vietnamese one the app sends: "danh từ", "động từ"…).
    private func posColor(_ label: String) -> Color {
        let l = label.lowercased()
        // deep shades: readable as text on a light tint and on a white pill
        if l.contains("danh từ") { return hex(0x1D4ED8) } // noun: blue
        if l.contains("động từ") { return hex(0x15803D) } // verb (incl. auxiliary, modal): green
        if l.contains("tính từ") { return hex(0xC2410C) } // adjective: orange
        if l.contains("trạng từ") { return hex(0x7E22CE) } // adverb: purple
        if l.contains("đại từ") { return hex(0xBE185D) } // pronoun: pink
        if l.contains("giới từ") { return hex(0x0F766E) } // preposition: teal
        if l.contains("liên từ") { return hex(0x92400E) } // conjunction: amber
        if l.contains("thán từ") { return hex(0xB91C1C) } // interjection: red
        if l.contains("số từ") { return hex(0x0E7490) } // numeral: cyan
        return hex(0x374151)
    }

    /// Fill of the part-of-speech tag on dark backgrounds: a bright tint of the tag's colour (never white, so it differs from the text),
    /// with near-black text on top.
    private func posFillOnDark(_ label: String) -> Color {
        let l = label.lowercased()
        if l.contains("danh từ") { return hex(0x93C5FD) }
        if l.contains("động từ") { return hex(0x86EFAC) }
        if l.contains("tính từ") { return hex(0xFDBA74) }
        if l.contains("trạng từ") { return hex(0xD8B4FE) }
        if l.contains("đại từ") { return hex(0xF9A8D4) }
        if l.contains("giới từ") { return hex(0x5EEAD4) }
        if l.contains("liên từ") { return hex(0xFCD34D) }
        if l.contains("thán từ") { return hex(0xFCA5A5) }
        if l.contains("số từ") { return hex(0x67E8F9) }
        return hex(0xD1D5DB)
    }

    /// Row 1: the word or sentence (wraps over several lines, never cut; shrinks if very long). Row 2: pronunciation, part of speech
    /// (coloured by kind) and the previous / next buttons. Row 3: the meaning, big, shrinking to fit the widget.
    private func card(_ word: WidgetWord) -> some View {
        let small = family == .systemSmall
        let long = word.w.count > 28
        let wordSize: CGFloat = long ? (small ? 15 : 20) : (small ? 24 : 32)
        return VStack(alignment: .leading, spacing: small ? 4 : 6) {
            Text(word.w)
                .font(.system(size: wordSize, weight: .bold))
                .foregroundColor(pal.ink)
                .lineLimit(long ? 5 : 2)
                .minimumScaleFactor(0.5)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(3)
            HStack(spacing: 6) {
                if let ipa = word.ipa, !ipa.isEmpty {
                    Text(ipa)
                        .font(.system(size: small ? 13 : 16))
                        .foregroundColor(pal.accent)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .layoutPriority(1)
                }
                if let p = word.p, !p.isEmpty {
                    let c = posColor(p)
                    Text(p)
                        .font(.system(size: small ? 11 : 13, weight: .bold))
                        .foregroundColor(pal.onDark ? hex(0x111827) : c)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Capsule().fill(pal.onDark ? posFillOnDark(p) : c.opacity(0.14)))
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                Spacer(minLength: 0)
            }
            Text(word.vi)
                .font(.system(size: small ? 19 : 26, weight: .semibold))
                .foregroundColor(pal.ink)
                .lineLimit(5)
                .minimumScaleFactor(0.4)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            // previous (bottom left) / next (bottom right) word at once, no waiting for the next hour; the circles contrast with the background
            HStack {
                Button(intent: PrevWordIntent()) { navIcon("chevron.left", small: small) }.buttonStyle(.plain)
                Spacer(minLength: 0)
                Button(intent: NextWordIntent()) { navIcon("chevron.right", small: small) }.buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func navIcon(_ name: String, small: Bool) -> some View {
        Image(systemName: name)
            .font(.system(size: 10, weight: .heavy))
            .foregroundColor(pal.btnFG)
            .frame(width: 22, height: 22)
            .background(Circle().fill(pal.btnBG))
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
