import SwiftUI

/// LingoLens for iPhone: the same web UI as the Android app (lookup, vocabulary notebook,
/// settings) running from the app bundle, fully offline.
@main
struct MangaLingoApp: App {
    @StateObject private var reader = ReaderPresenter.shared

    var body: some Scene {
        WindowGroup {
            WebContainer()
                .modifier(TranslationHost())
                // edge to edge: the web UI pads itself with env(safe-area-inset-*)
                .ignoresSafeArea()
                .background(Color(red: 16 / 255, green: 18 / 255, blue: 24 / 255).ignoresSafeArea())
                // the in-app browser (translate websites while reading) – the web UI keeps running underneath
                .fullScreenCover(isPresented: $reader.isPresented) {
                    WebReaderView(startURL: reader.startURL, onClose: { reader.isPresented = false })
                }
        }
    }
}
