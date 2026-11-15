import AVFoundation

/// English pronunciation with the system speech engine.
///
/// Voice: the best installed en-US voice – Premium › Enhanced › (default compact). The list is
/// checked at every request, so a voice the user downloads later (Settings → Accessibility →
/// Spoken Content → Voices → English → e.g. "Ava (Premium)", "Zoe (Enhanced)") is used at once.
/// If only the low-quality compact voices exist, the user's own Spoken Content voice is preferred.
/// Audio: the session is configured once (re-activating it for every utterance caused crackling),
/// plays with the silent switch on and lowers other audio while speaking.
final class Speaker {
    static let shared = Speaker()
    private let synth = AVSpeechSynthesizer()
    private var sessionReady = false

    /// Preferred natural-sounding voices, best first (any quality); novelty voices are excluded.
    private static let preferredNames = ["Ava", "Zoe", "Evan", "Nathan", "Joelle", "Noelle", "Tom", "Allison", "Susan", "Samantha", "Alex"]

    private func bestVoice() -> AVSpeechSynthesisVoice? {
        let english = AVSpeechSynthesisVoice.speechVoices().filter { v in
            guard v.language == "en-US" else { return false }
            if #available(iOS 17.0, *) { return !v.voiceTraits.contains(.isNoveltyVoice) }
            return true
        }
        func score(_ v: AVSpeechSynthesisVoice) -> Int {
            let q: Int
            switch v.quality {
            case .premium: q = 300
            case .enhanced: q = 200
            default: q = 100
            }
            let i = Self.preferredNames.firstIndex { v.name.contains($0) } ?? Self.preferredNames.count
            return q - i
        }
        return english.max { score($0) < score($1) }
    }

    private func prepareSession() {
        guard !sessionReady else { return }
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? s.setActive(true)
        sessionReady = true
    }

    /// rate: 1 = normal speaking speed (0.5…1.6).
    func speak(_ text: String, rate: Double) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        prepareSession()
        if synth.isSpeaking { synth.stopSpeaking(at: .word) }
        let u = AVSpeechUtterance(string: t)
        let voice = bestVoice()
        if let voice, voice.quality != .default {
            u.voice = voice
        } else if #available(iOS 17.0, *) {
            // only compact voices installed: use the voice chosen in the iPhone's Spoken Content settings
            u.prefersAssistiveTechnologySettings = true
            u.voice = voice
        } else {
            u.voice = voice
        }
        let r = Float(AVSpeechUtteranceDefaultSpeechRate) * Float(max(0.5, min(1.6, rate)))
        u.rate = max(AVSpeechUtteranceMinimumSpeechRate, min(AVSpeechUtteranceMaximumSpeechRate, r))
        u.pitchMultiplier = 1
        u.volume = 1
        u.preUtteranceDelay = 0.02
        synth.speak(u)
    }

    /// Name and quality of the voice in use (shown in the app so the user knows to download a better one).
    func voiceInfo() -> [String: Any] {
        guard let v = bestVoice() else { return ["name": "", "quality": "none"] }
        let q: String
        switch v.quality {
        case .premium: q = "premium"
        case .enhanced: q = "enhanced"
        default: q = "compact"
        }
        return ["name": v.name, "quality": q]
    }
}
