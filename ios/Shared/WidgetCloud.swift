import CryptoKit
import Foundation

/// Encrypted sync of the saved words to a GitHub repository, for when the widget cannot share files with the app (a free Apple ID has no
/// App Group). Shared by the app (writes) and the widget (reads).
///
/// - The list is encrypted on the phone with AES-256-GCM before it leaves it; the repository only ever holds ciphertext.
/// - The repository is PUBLIC so the widget can read it without any password. The key is NOT in the repository: it lives in the
///   "sync code" the user pastes into the widget once, and in the app.
/// - Only the app holds a GitHub token (write access to that one repository), in the iOS Keychain. The widget never has it.

/// Pasted into the widget once: where the encrypted list lives, and the key to open it. Contains no GitHub token.
struct WidgetSyncCode: Equatable {
    var repo: String // "owner/name"
    var key: Data // 32 bytes

    var string: String { "LL1~\(repo)~\(WidgetSyncCode.b64url(key))" }

    static func parse(_ text: String) -> WidgetSyncCode? {
        let parts = text.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "~", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 3, parts[0] == "LL1", validRepo(parts[1]), let key = fromB64url(parts[2]), key.count == 32 else { return nil }
        return WidgetSyncCode(repo: parts[1], key: key)
    }

    static func validRepo(_ s: String) -> Bool {
        let p = s.split(separator: "/", omittingEmptySubsequences: false)
        let ok = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.")
        return p.count == 2 && p.allSatisfy { !$0.isEmpty && String($0).unicodeScalars.allSatisfy { ok.contains($0) } }
    }

    static func b64url(_ d: Data) -> String {
        d.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    static func fromB64url(_ s: String) -> Data? {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        return Data(base64Encoded: b)
    }
}

enum WidgetCloudError: Error, CustomStringConvertible {
    case badRepo
    case http(Int)
    case format
    case crypto

    var description: String {
        switch self {
        case .badRepo: return "Tên repo không hợp lệ (dạng chu-so-huu/ten-repo)."
        case .http(let c) where c == 401: return "GitHub từ chối (401): quyền GitHub của app đã hết hiệu lực. Bấm “Đăng nhập lại GitHub”."
        case .http(let c) where c == 403: return "GitHub từ chối (403): tài khoản không có quyền ghi vào repo. Bấm “Đăng nhập lại GitHub”."
        case .http(let c) where c == 404: return "Không thấy repo hoặc dữ liệu (404). Repo phải là CÔNG KHAI."
        case .http(let c): return "GitHub trả lỗi \(c)."
        case .format: return "Dữ liệu trên GitHub không đọc được."
        case .crypto: return "Không giải mã được (sai mã đồng bộ?)."
        }
    }
}

enum WidgetCrypto {
    /// The file written to the repository: {"v":"1","d":"<base64 nonce+ciphertext+tag>"}
    static func seal(_ snapshot: WidgetSnapshot, key: Data) throws -> Data {
        let plain = try JSONEncoder().encode(snapshot)
        let box = try AES.GCM.seal(plain, using: SymmetricKey(data: key))
        guard let combined = box.combined else { throw WidgetCloudError.crypto }
        return try JSONEncoder().encode(["v": "1", "d": combined.base64EncodedString()])
    }

    static func open(_ file: Data, key: Data) throws -> WidgetSnapshot {
        guard let obj = try? JSONSerialization.jsonObject(with: file) as? [String: String], let d = obj["d"], let combined = Data(base64Encoded: d) else {
            throw WidgetCloudError.format
        }
        do {
            let box = try AES.GCM.SealedBox(combined: combined)
            let plain = try AES.GCM.open(box, using: SymmetricKey(data: key))
            return try JSONDecoder().decode(WidgetSnapshot.self, from: plain)
        } catch {
            throw WidgetCloudError.crypto
        }
    }
}

enum WidgetCloud {
    static let path = "lingolens-words.json"

    private static func contentsURL(_ repo: String) throws -> URL {
        guard WidgetSyncCode.validRepo(repo), let url = URL(string: "https://api.github.com/repos/\(repo)/contents/\(path)") else { throw WidgetCloudError.badRepo }
        return url
    }

    /// Widget side: reads the public file (no token) and decrypts it.
    static func fetch(_ code: WidgetSyncCode, timeout: TimeInterval = 15) async throws -> WidgetSnapshot {
        // GitHub answers unauthenticated reads with "Cache-Control: public, max-age=60": without a fresh query the widget, asked to reload
        // right after the app uploaded, got the PREVIOUS list from a shared cache and kept it for hours. A changing query asks for the
        // current file (the request is the same single read; nothing is retried).
        var parts = URLComponents(url: try contentsURL(code.repo), resolvingAgainstBaseURL: false)
        parts?.queryItems = [URLQueryItem(name: "t", value: String(Int(Date().timeIntervalSince1970)))]
        guard let url = parts?.url else { throw WidgetCloudError.badRepo }
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: timeout)
        req.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        req.setValue("application/vnd.github.raw+json", forHTTPHeaderField: "Accept")
        req.setValue("LingoLens-widget", forHTTPHeaderField: "User-Agent")
        let (data, resp) = try await URLSession.shared.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw WidgetCloudError.http(status) }
        return try WidgetCrypto.open(data, key: code.key)
    }

    /// App side: encrypts and writes the file (creating it the first time). Needs the GitHub token of the app.
    static func push(_ snapshot: WidgetSnapshot, code: WidgetSyncCode, token: String) async throws {
        let url = try contentsURL(code.repo)
        let body = try WidgetCrypto.seal(snapshot, key: code.key)

        func request(_ method: String) -> URLRequest {
            var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
            r.httpMethod = method
            r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            r.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            r.setValue("LingoLens-app", forHTTPHeaderField: "User-Agent")
            return r
        }

        for attempt in 0..<2 {
            // the current version of the file (404 = it does not exist yet)
            var sha: String?
            let (current, r1) = try await URLSession.shared.data(for: request("GET"))
            let s1 = (r1 as? HTTPURLResponse)?.statusCode ?? 0
            if s1 == 200 {
                sha = (try? JSONSerialization.jsonObject(with: current) as? [String: Any])?["sha"] as? String
            } else if s1 != 404 {
                throw WidgetCloudError.http(s1)
            }
            var put = request("PUT")
            put.setValue("application/json", forHTTPHeaderField: "Content-Type")
            var payload: [String: Any] = ["message": "sync", "content": body.base64EncodedString()]
            if let sha = sha { payload["sha"] = sha }
            put.httpBody = try JSONSerialization.data(withJSONObject: payload)
            let (_, r2) = try await URLSession.shared.data(for: put)
            let s2 = (r2 as? HTTPURLResponse)?.statusCode ?? 0
            if s2 == 200 || s2 == 201 { return }
            if (s2 == 409 || s2 == 422) && attempt == 0 { continue } // somebody changed it in between: read the version again, once
            throw WidgetCloudError.http(s2)
        }
    }
}
