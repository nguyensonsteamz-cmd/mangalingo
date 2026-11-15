import SwiftUI
#if canImport(Translation)
import Translation
#endif

/// English → Vietnamese machine translation with Apple's on-device Translation framework (iOS 18+).
/// The web UI asks through the bridge:
///   {cmd: "translate", text} → {text}
///   {cmd: "mtStatus"}        → {status: "installed" | "download" | "unsupported" | "unavailable"}
///   {cmd: "mtPrepare"}       → downloads the Vietnamese pack ahead of time (iOS shows its sheet)
/// Jobs are queued here and a hidden SwiftUI view runs them inside `.translationTask` – the only
/// way to obtain a TranslationSession.
final class TranslationQueue: ObservableObject {
    static let shared = TranslationQueue()

    typealias Reply = (String?, String?) -> Void
    enum Job {
        case translate(String, Reply)
        case prepare(Reply)
    }

    @Published private(set) var version = 0
    private var pending: [Job] = []

    static var isAvailable: Bool {
        if #available(iOS 18.0, *) { return true }
        return false
    }

    func enqueue(_ job: Job) {
        DispatchQueue.main.async {
            self.pending.append(job)
            self.version += 1
        }
    }

    func enqueue(_ text: String, reply: @escaping Reply) { enqueue(.translate(text, reply)) }

    /// Takes everything queued so far (main thread).
    func take() -> [Job] {
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
    @ObservedObject private var queue = TranslationQueue.shared
    @State private var config: TranslationSession.Configuration?

    var body: some View {
        Color.clear
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
            .translationTask(config) { session in
                let jobs = await MainActor.run { queue.take() }
                for job in jobs {
                    switch job {
                    case let .translate(text, reply):
                        do {
                            let response = try await session.translate(text)
                            await MainActor.run { reply(response.targetText, nil) }
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
            .onChange(of: queue.version) {
                // new work: start a session (first time) or re-run the task with the same languages
                if config == nil {
                    config = TranslationSession.Configuration(source: Locale.Language(identifier: "en"), target: Locale.Language(identifier: "vi"))
                } else {
                    config?.invalidate()
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
