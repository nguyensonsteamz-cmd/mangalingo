import SwiftUI
#if canImport(Translation)
import Translation
#endif

/// English → Vietnamese machine translation with Apple's on-device Translation framework (iOS 18+).
/// The web UI asks through the bridge ({cmd: "translate", text}); requests are queued here and a
/// hidden SwiftUI view runs them inside `.translationTask` (the only way to get a session).
/// The first time, iOS shows its own sheet to download the Vietnamese language pack.
final class TranslationQueue: ObservableObject {
    static let shared = TranslationQueue()

    typealias Reply = (String?, String?) -> Void
    @Published private(set) var version = 0
    private var pending: [(text: String, reply: Reply)] = []

    static var isAvailable: Bool {
        if #available(iOS 18.0, *) { return true }
        return false
    }

    func enqueue(_ text: String, reply: @escaping Reply) {
        DispatchQueue.main.async {
            self.pending.append((text, reply))
            self.version += 1
        }
    }

    /// Takes everything queued so far (main thread).
    func take() -> [(text: String, reply: Reply)] {
        let items = pending
        pending = []
        return items
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
                let items = await MainActor.run { queue.take() }
                for item in items {
                    do {
                        let response = try await session.translate(item.text)
                        await MainActor.run { item.reply(response.targetText, nil) }
                    } catch {
                        await MainActor.run { item.reply(nil, error.localizedDescription) }
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
