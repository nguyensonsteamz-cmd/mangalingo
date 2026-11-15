import Foundation

extension Notification.Name {
    /// A new image arrived from the Shortcuts action (posted on the main thread).
    static let mlNewScan = Notification.Name("MangaLingoNewScan")
}

/// The latest image handed to LingoLens by the Shortcuts action, kept in the app's caches folder.
enum PendingScan {
    private static var url: URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("pending-scan.img")
    }

    private static let stampKey = "pendingScanStamp"

    static func save(_ data: Data) throws {
        try data.write(to: url, options: .atomic)
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: stampKey)
    }

    static func load() -> Data? { try? Data(contentsOf: url) }

    /// Seconds since 1970 of the latest image (0 = none).
    static var stamp: Double { UserDefaults.standard.double(forKey: stampKey) }

    /// MIME type from the first bytes (screenshots are PNG; photos may be JPEG / HEIC).
    static func mime(of data: Data) -> String {
        let b = [UInt8](data.prefix(12))
        if b.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if b.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if b.count >= 12, String(bytes: b[4..<12], encoding: .ascii)?.hasPrefix("ftyphei") == true { return "image/heic" }
        return "application/octet-stream"
    }
}
