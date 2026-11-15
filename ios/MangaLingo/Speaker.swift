import AVFoundation

/// English pronunciation with the system speech engine: the best installed en-US voice
/// (premium › enhanced › default, never a novelty voice), plays even with the silent switch on.
final class Speaker {
    static let shared = Speaker()
    private let synth = AVSpeechSynthesizer()

    private lazy var voice: AVSpeechSynthesisVoice? = {
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { v in
            guard v.language == "en-US" else { return false }
            if #available(iOS 17.0, *) { return !v.voiceTraits.contains(.isNoveltyVoice) }
            return true
        }
        let best = voices.max { a, b in a.quality.rawValue < b.quality.rawValue }
        return best ?? AVSpeechSynthesisVoice(language: "en-US")
    }()

    /// rate: 1 = normal speaking speed (0.5…1.6).
    func speak(_ text: String, rate: Double) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        if synth.isSpeaking { synth.stopSpeaking(at: .immediate) }
        let u = AVSpeechUtterance(string: t)
        u.voice = voice
        let r = Float(AVSpeechUtteranceDefaultSpeechRate) * Float(max(0.5, min(1.6, rate)))
        u.rate = max(AVSpeechUtteranceMinimumSpeechRate, min(AVSpeechUtteranceMaximumSpeechRate, r))
        u.preUtteranceDelay = 0
        synth.speak(u)
    }
}
