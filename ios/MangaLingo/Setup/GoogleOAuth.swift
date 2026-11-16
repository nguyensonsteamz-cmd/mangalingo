import AuthenticationServices
import CryptoKit
import SafariServices
import UIKit

/// Google sign-in for Smart Setup: OAuth 2.0 Authorization Code + PKCE through ASWebAuthenticationSession (the system's
/// secure sign-in sheet, which App Store policy expects – never an embedded web view). iOS-type client: a public client,
/// no client secret exists or is used. The access token goes to the web UI for the length of the setup and is revoked at
/// the end; it is never stored and no refresh token is kept.
///
/// The client id is a PUBLIC identifier injected at build time (Info.plist key LingoLensGoogleClientID, from the build
/// setting LINGOLENS_GOOGLE_IOS_CLIENT_ID). Empty = Smart Setup says it is not configured in this build.
final class GoogleOAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = GoogleOAuth()

    enum OAuthError: LocalizedError {
        case notConfigured, cancelled, badResponse, network
        var errorDescription: String? {
            switch self {
            case .notConfigured: return "Smart Setup chưa được cấu hình đăng nhập Google."
            case .cancelled: return "Bạn đã huỷ đăng nhập."
            case .badResponse: return "Phản hồi đăng nhập không hợp lệ."
            case .network: return "Không kết nối được tới Google."
            }
        }
    }

    private static let suffix = ".apps.googleusercontent.com"
    private var session: ASWebAuthenticationSession?

    static var clientID: String {
        ((Bundle.main.object(forInfoDictionaryKey: "LingoLensGoogleClientID") as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }
    static var isConfigured: Bool {
        let id = clientID
        return id.hasSuffix(suffix) && id.count > suffix.count + 4
    }
    private var scheme: String { "com.googleusercontent.apps." + Self.clientID.replacingOccurrences(of: Self.suffix, with: "") }
    private var redirectURI: String { scheme + ":/oauth2redirect" }

    private static func random(_ n: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: n)
        _ = SecRandomCopyBytes(kSecRandomDefault, n, &bytes)
        return base64URL(Data(bytes))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// Completion is called on the main thread with ["accessToken": String, "expiresIn": Int].
    func start(scopes: [String], completion: @escaping (Result<[String: Any], Error>) -> Void) {
        guard Self.isConfigured else {
            completion(.failure(OAuthError.notConfigured))
            return
        }
        let verifier = Self.random(48)
        let challenge = Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.random(18)
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")
        components?.queryItems = [
            URLQueryItem(name: "client_id", value: Self.clientID),
            URLQueryItem(name: "redirect_uri", value: redirectURI),
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "scope", value: scopes.joined(separator: " ")),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: state),
            URLQueryItem(name: "prompt", value: "select_account"),
        ]
        guard let url = components?.url else {
            completion(.failure(OAuthError.badResponse))
            return
        }
        let web = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
            DispatchQueue.main.async {
                self?.session = nil
                if let error = error {
                    let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                    completion(.failure(cancelled ? OAuthError.cancelled : error))
                    return
                }
                guard let callback = callback,
                      let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
                      items.first(where: { $0.name == "state" })?.value == state,
                      let code = items.first(where: { $0.name == "code" })?.value else {
                    completion(.failure(OAuthError.badResponse))
                    return
                }
                self?.exchange(code: code, verifier: verifier, completion: completion)
            }
        }
        web.presentationContextProvider = self
        web.prefersEphemeralWebBrowserSession = false // reuse the user's Google session in Safari
        session = web
        web.start()
    }

    private func exchange(code: String, verifier: String, completion: @escaping (Result<[String: Any], Error>) -> Void) {
        let form: [(String, String)] = [
            ("client_id", Self.clientID), ("code", code), ("code_verifier", verifier),
            ("grant_type", "authorization_code"), ("redirect_uri", redirectURI),
        ]
        guard let url = URL(string: "https://oauth2.googleapis.com/token") else { return }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Self.encode(form)
        URLSession.shared.dataTask(with: request) { data, _, error in
            DispatchQueue.main.async {
                guard error == nil, let data = data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                    completion(.failure(OAuthError.network))
                    return
                }
                guard let token = json["access_token"] as? String, !token.isEmpty else {
                    completion(.failure(OAuthError.badResponse))
                    return
                }
                completion(.success(["accessToken": token, "expiresIn": (json["expires_in"] as? Int) ?? 3300]))
            }
        }.resume()
    }

    func revoke(_ token: String) {
        guard let url = URL(string: "https://oauth2.googleapis.com/revoke") else { return }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = Self.encode([("token", token)])
        URLSession.shared.dataTask(with: request) { _, _, _ in }.resume() // offline: the token expires by itself
    }

    private static func encode(_ pairs: [(String, String)]) -> Data {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return Data(pairs.map { "\($0.0)=\($0.1.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")" }.joined(separator: "&").utf8)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
        return windows.first(where: { $0.isKeyWindow }) ?? windows.first ?? ASPresentationAnchor()
    }
}

/// Google Cloud Console pages open in a secure Safari sheet (https only), never inside the app's own web view.
enum SafariPresenter {
    static func present(_ urlString: String) {
        guard let url = URL(string: urlString), url.scheme?.lowercased() == "https" else { return }
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
        var top = windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let next = top?.presentedViewController { top = next }
        top?.present(SFSafariViewController(url: url), animated: true)
    }
}
