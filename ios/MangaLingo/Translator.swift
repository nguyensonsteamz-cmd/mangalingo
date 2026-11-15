import SwiftUI
#if canImport(Translation)
import Translation
#endif

/// English → Vietnamese machine translation with Apple's on-device Translation framework (iOS 18+).
/// The web UI asks through the bridge:
///   {cmd: "translateBatch", texts} → {texts}   (all bubbles of a page in one request)
///   {cmd: "translate", text}       → {text}
///   {cmd: "mtStatus"}              → {status: "installed" | "download" | "unsupported" | "unavailable"}
///   {cmd: "mtPrepare"}             → downloads the Vietnamese pack ahead of time (iOS shows its sheet)
///
/// Speed: ONE session is opened when the app starts and kept alive – a hidden SwiftUI view runs a
/// `.translationTask` whose closure never returns, it waits for jobs and handles them as they come.
/// So the language model is loaded once, not for every bubble.
final class TranslationQueue: ObservableObject {
    static let shared = TranslationQueue()

    typealias Reply = (Any?, String?) -> Void
    enum Job {
        case translate([String], Reply)
        case prepare(Reply)
    }

    private var pending: [Job] = []
    private var waiter: CheckedContinuation<Void, Never>?

    static var isAvailable: Bool {
        if #available(iOS 18.0, *) { return true }
        return false
    }

    func enqueue(_ job: Job) {
        DispatchQueue.main.async {
            self.pending.append(job)
            self.waiter?.resume()
            self.waiter = nil
        }
    }

    /// Waits until there is work, then takes all of it (main actor).
    @MainActor
    func next() async -> [Job] {
        if pending.isEmpty {
            await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in waiter = c }
        }
        let items = pending
        pending = []
        return items
    }

    /// Is the EN→VI pack installed, downloadable or unsupported?
    static func status(_ reply: @escaping (String) -> Void) {
        #if canImport(Translation)
        if #available(iOS 18.0, *) {
            Task {
                let s = await LanguageAvailability().status(from: Locale.Language(identifier: "en"), to: Locale.Language(identifier: "vi"))
                let value: String
                switch s {
                case .installed: value = "installed"
                case .supported: value = "download"
                case .unsupported: value = "unsupported"
                @unknown default: value = "unsupported"
                }
                await MainActor.run { reply(value) }
            }
            return
        }
        #endif
        reply("unavailable")
    }
}

#if canImport(Translation)
@available(iOS 18.0, *)
struct TranslationBridge: View {
    // created at launch: the session (and the language model) is ready before the first scan
    @State private var config: TranslationSession.Configuration? = TranslationSession.Configuration(
        source: Locale.Language(identifier: "en"), target: Locale.Language(identifier: "vi"))

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .translationTask(config) { session in
                // long-lived worker: one session for the whole app run
                while !Task.isCancelled {
                    let jobs = await TranslationQueue.shared.next()
                    for job in jobs {
                        switch job {
                        case let .translate(texts, reply):
                            do {
                                let requests = texts.enumerated().map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
                                let responses = try await session.translations(from: requests)
                                var out = Array(repeating: "", count: texts.count)
                                for r in responses {
                                    if let id = r.clientIdentifier, let i = Int(id), i < out.count { out[i] = r.targetText }
                                }
                                await MainActor.run { reply(out, nil) }
                            } catch {
                                await MainActor.run { reply(nil, error.localizedDescription) }
                            }
                        case let .prepare(reply):
                            do {
                                try await session.prepareTranslation()
                                await MainActor.run { reply("ok", nil) }
                            } catch {
                                await MainActor.run { reply(nil, error.localizedDescription) }
                            }
                        }
                    }
                }
            }
    }
}
#endif

/// Adds the hidden translation runner on iOS 18+, nothing on older systems.
struct TranslationHost: ViewModifier {
    func body(content: Content) -> some View {
        #if canImport(Translation)
        if #available(iOS 18.0, *) {
            content.background(TranslationBridge())
        } else {
            content
        }
        #else
        content
        #endif
    }
}
