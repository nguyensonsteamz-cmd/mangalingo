import AVFoundation

/// English pronunciation with the system speech engine.
///
/// Voice: the best installed en-US voice – Premium › Enhanced › (default compact). The list is
/// checked at every request, so a voice the user downloads later (Settings → Accessibility →
/// Spoken Content → Voices → English → e.g. "Ava (Premium)", "Zoe (Enhanced)") is used at once.
/// If only the low-quality compact voices exist, the user's own Spoken Content voice is preferred.
/// Audio: the session is configured once (re-activating it for every utterance caused crackling),
/// plays with the silent switch on and lowers other audio while speaking; the session is released
/// when speech ends so other audio comes back to full volume.
///
/// Whole sentences: the text is cut into sentence-sized utterances (a long single utterance can be
/// cut off or skipped) that are queued in order. A new request while something is speaking stops
/// it with `.immediate` and starts the new text from `didCancel` – calling `speak` right after
/// `stopSpeaking` makes AVSpeechSynthesizer drop the new utterance, which is what made single
/// words and sentences go silent or get cut.
final class Speaker: NSObject, AVSpeechSynthesizerDelegate {
    static let shared = Speaker()
    private let synth = AVSpeechSynthesizer()
    private var sessionReady = false
    private var queued = 0
    private var next: (text: String, rate: Double)?

    override init() {
        super.init()
        synth.delegate = self
    }

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
        let s = AVAudioSession.sharedInstance()
        if !sessionReady {
            try? s.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            sessionReady = true
        }
        try? s.setActive(true)
    }

    private func releaseSession() {
        // other audio returns to full volume
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    /// Sentence-sized pieces (≤ maxLength characters); nothing is dropped.
    static func pieces(_ text: String, maxLength: Int = 200) -> [String] {
        var out: [String] = []
        var cur = ""
        func flush() {
            let t = cur.trimmingCharacters(in: .whitespacesAndNewlines)
            if !t.isEmpty { out.append(t) }
            cur = ""
        }
        text.enumerateSubstrings(in: text.startIndex..<text.endIndex, options: .bySentences) { sub, _, _, _ in
            guard var s = sub else { return }
            while s.count > maxLength {
                // a very long sentence: cut at the last comma / space before the limit
                let head = s.prefix(maxLength)
                var cut = head.lastIndex(of: ",") ?? head.lastIndex(of: " ") ?? head.endIndex
                if cut == head.endIndex || head.distance(from: head.startIndex, to: cut) < 40 { cut = head.endIndex } else { cut = head.index(after: cut) }
                if !cur.isEmpty { flush() }
                out.append(String(s[s.startIndex..<cut]).trimmingCharacters(in: .whitespacesAndNewlines))
                s = String(s[cut...])
            }
            if cur.count + s.count > maxLength { flush() }
            cur += s
        }
        flush()
        return out.isEmpty ? [text] : out
    }

    /// rate: 1 = normal speaking speed (0.5…1.6).
    func speak(_ text: String, rate: Double) {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        if synth.isSpeaking || queued > 0 {
            // start the new text once the engine has really stopped (see the class comment)
            next = (t, rate)
            synth.stopSpeaking(at: .immediate)
            return
        }
        start(t, rate: rate)
    }

    private func start(_ text: String, rate: Double) {
        prepareSession()
        let voice = bestVoice()
        let r = Float(AVSpeechUtteranceDefaultSpeechRate) * Float(max(0.5, min(1.6, rate)))
        for piece in Self.pieces(text) {
            let u = AVSpeechUtterance(string: piece)
            if let voice, voice.quality != .default {
                u.voice = voice
            } else if #available(iOS 17.0, *) {
                // only compact voices installed: use the voice chosen in the iPhone's Spoken Content settings
                u.prefersAssistiveTechnologySettings = true
                u.voice = voice
            } else {
                u.voice = voice
            }
            u.rate = max(AVSpeechUtteranceMinimumSpeechRate, min(AVSpeechUtteranceMaximumSpeechRate, r))
            u.pitchMultiplier = 1
            u.volume = 1
            u.preUtteranceDelay = 0
            u.postUtteranceDelay = 0.05
            queued += 1
            synth.speak(u)
        }
    }

    // MARK: AVSpeechSynthesizerDelegate (callbacks arrive on the main thread)
    private func finished() {
        queued = max(0, queued - 1)
        if queued == 0 {
            if let n = next {
                next = nil
                start(n.text, rate: n.rate)
            } else {
                releaseSession()
            }
        }
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { finished() }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { finished() }

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
