import Foundation

/// "Sign in with GitHub" for the widget sync, without typing a token: GitHub's device flow. The app shows a short code, the user enters it
/// on github.com/login/device and taps Authorize; the app then gets a token, creates the (public) repository that holds the encrypted
/// word list, and connects the sync. The OAuth client id is public (no secret exists in the device flow).
///
/// The scope is `public_repo`: GitHub has no narrower scope that lets an app create a repository. The token is stored only in this
/// phone's Keychain and the app only ever touches the one repository it creates. It can be revoked at github.com/settings/applications.
enum GitHubLogin {
    static let repoName = "lingolens-sync"

    struct Failure: Error, CustomStringConvertible {
        let description: String
    }

    static var clientID: String {
        (Bundle.main.object(forInfoDictionaryKey: "LingoLensGitHubClientID") as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// false until the developer has registered a GitHub OAuth app (the manual token form is shown instead).
    static var isConfigured: Bool { !clientID.isEmpty && !clientID.hasPrefix("$(") }

    private static let formSafe = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))

    private static func post(_ url: String, _ form: [String: String]) async throws -> [String: Any] {
        guard let u = URL(string: url) else { throw Failure(description: "Địa chỉ không hợp lệ.") }
        var r = URLRequest(url: u, timeoutInterval: 20)
        r.httpMethod = "POST"
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        r.setValue("LingoLens-app", forHTTPHeaderField: "User-Agent")
        let body = form.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: formSafe) ?? "")" }.joined(separator: "&")
        r.httpBody = Data(body.utf8)
        let (data, _) = try await URLSession.shared.data(for: r)
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    /// Step 1: asks GitHub for a code the user types on github.com/login/device.
    static func start() async throws -> [String: Any] {
        guard isConfigured else { throw Failure(description: "Chưa cấu hình đăng nhập GitHub trong bản này.") }
        let j = try await post("https://github.com/login/device/code", ["client_id": clientID, "scope": "public_repo"])
        guard let user = j["user_code"] as? String, let device = j["device_code"] as? String, let url = j["verification_uri"] as? String else {
            throw Failure(description: (j["error_description"] as? String) ?? "GitHub không phản hồi. Thử lại sau.")
        }
        return ["userCode": user, "deviceCode": device, "verifyUrl": url, "interval": (j["interval"] as? Int) ?? 5, "expiresIn": (j["expires_in"] as? Int) ?? 900]
    }

    /// Step 2 (called every few seconds): nil = the user has not finished yet; a token when they have; throws when it cannot succeed.
    static func poll(deviceCode: String) async throws -> String? {
        let j = try await post("https://github.com/login/oauth/access_token", [
            "client_id": clientID,
            "device_code": deviceCode,
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
        ])
        if let token = j["access_token"] as? String { return token }
        switch j["error"] as? String {
        case "authorization_pending", "slow_down": return nil
        case "expired_token": throw Failure(description: "Mã đã hết hạn. Bấm lại để lấy mã mới.")
        case "access_denied": throw Failure(description: "Bạn đã từ chối trên GitHub.")
        default: throw Failure(description: (j["error_description"] as? String) ?? "GitHub báo lỗi. Thử lại.")
        }
    }

    /// Step 3: with the token, finds the user name and makes sure the public repository exists. Returns "user/repo".
    static func prepareRepository(token: String) async throws -> String {
        func request(_ url: String, _ method: String) throws -> URLRequest {
            guard let u = URL(string: url) else { throw Failure(description: "Địa chỉ không hợp lệ.") }
            var r = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
            r.httpMethod = method
            r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            r.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
            r.setValue("LingoLens-app", forHTTPHeaderField: "User-Agent")
            return r
        }
        let (userData, userResp) = try await URLSession.shared.data(for: request("https://api.github.com/user", "GET"))
        guard (userResp as? HTTPURLResponse)?.statusCode == 200,
              let login = (try? JSONSerialization.jsonObject(with: userData) as? [String: Any])?["login"] as? String
        else { throw Failure(description: "Không đọc được tài khoản GitHub.") }

        var create = try request("https://api.github.com/user/repos", "POST")
        create.setValue("application/json", forHTTPHeaderField: "Content-Type")
        create.httpBody = try JSONSerialization.data(withJSONObject: [
            "name": repoName,
            "private": false,
            "auto_init": true,
            "description": "LingoLens widget sync (encrypted word list). Safe to delete.",
        ] as [String: Any])
        let (_, createResp) = try await URLSession.shared.data(for: create)
        let status = (createResp as? HTTPURLResponse)?.statusCode ?? 0
        // 201 = created; 422 = it already exists (from an earlier connection): fine
        guard status == 201 || status == 422 else { throw Failure(description: "Không tạo được repo trên GitHub (\(status)).") }
        return "\(login)/\(repoName)"
    }
}
