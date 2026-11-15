import CoreGraphics
import Foundation
import UIKit
import Vision

/// On-device OCR with Apple Vision. Returns lines (text, confidence 0–100, box) with word boxes,
/// all normalised 0..1 to the WHOLE image with a top-left origin (same format as the extension).
enum TextRecognizer {
    enum Failure: Error { case badImage }

    /// - Parameter region: optional crop, normalised 0..1, top-left origin.
    static func recognize(_ data: Data, region: CGRect?) throws -> [[String: Any]] {
        guard let image = UIImage(data: data), let full = normalizedCGImage(image) else { throw Failure.badImage }
        let W = CGFloat(full.width)
        let H = CGFloat(full.height)
        var crop = CGRect(x: 0, y: 0, width: W, height: H)
        var cg = full
        if let r = region {
            let px = CGRect(x: r.minX * W, y: r.minY * H, width: r.width * W, height: r.height * H).integral.intersection(crop)
            if px.width >= 8, px.height >= 8, let c = full.cropping(to: px) {
                crop = px
                cg = c
            }
        }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["en-US"]
        request.minimumTextHeight = 0
        try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])

        // Vision boxes: normalised to the crop, bottom-left origin → whole image, top-left origin.
        func map(_ b: CGRect) -> [String: Double] {
            [
                "x": Double((crop.minX + b.minX * crop.width) / W),
                "y": Double((crop.minY + (1 - b.maxY) * crop.height) / H),
                "w": Double(b.width * crop.width / W),
                "h": Double(b.height * crop.height / H),
            ]
        }

        var lines: [[String: Any]] = []
        for observation in request.results ?? [] {
            guard let candidate = observation.topCandidates(1).first else { continue }
            let text = candidate.string
            let confidence = Double(candidate.confidence) * 100
            var words: [[String: Any]] = []
            text.enumerateSubstrings(in: text.startIndex..<text.endIndex, options: .byWords) { word, range, _, _ in
                guard let word, let box = try? candidate.boundingBox(for: range)?.boundingBox else { return }
                words.append(["text": word, "confidence": confidence, "box": map(box)])
            }
            lines.append(["text": text, "confidence": confidence, "box": map(observation.boundingBox), "words": words])
        }
        return lines
    }

    /// Applies the EXIF orientation so pixel coordinates match what the user sees.
    private static func normalizedCGImage(_ image: UIImage) -> CGImage? {
        if image.imageOrientation == .up { return image.cgImage }
        let format = UIGraphicsImageRendererFormat()
        format.scale = image.scale
        let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
        let drawn = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: image.size)) }
        return drawn.cgImage
    }
}
