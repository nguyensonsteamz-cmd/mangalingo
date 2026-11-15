import SwiftUI

/// LingoLens for iPhone: the same web UI as the Android app (lookup, vocabulary notebook,
/// settings) running from the app bundle, fully offline.
@main
struct MangaLingoApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainer()
                .modifier(TranslationHost())
                // edge to edge: the web UI pads itself with env(safe-area-inset-*)
                .ignoresSafeArea()
                .background(Color(red: 16 / 255, green: 18 / 255, blue: 24 / 255).ignoresSafeArea())
        }
    }
}
