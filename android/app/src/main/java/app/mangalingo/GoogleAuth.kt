package app.mangalingo

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Google sign-in for Smart Setup: OAuth 2.0 Authorization Code + PKCE in the SYSTEM BROWSER (never an embedded
 * WebView), Android-type client (a public client: no client secret exists or is used). The redirect comes back
 * through the custom-scheme intent filter of MainActivity. The access token is handed to the web UI for the length
 * of the setup and revoked afterwards; it is never stored.
 *
 * The client id is a PUBLIC identifier injected at build time (BuildConfig.GOOGLE_CLIENT_ID); without it
 * [isConfigured] is false and the UI explains that Smart Setup is not configured in this build.
 */
object GoogleAuth {
    private const val PREFS = "lingolens_oauth"
    private const val SUFFIX = ".apps.googleusercontent.com"

    val clientId: String get() = BuildConfig.GOOGLE_CLIENT_ID
    val isConfigured: Boolean get() = clientId.endsWith(SUFFIX) && clientId.length > SUFFIX.length + 4
    private val scheme: String get() = "com.googleusercontent.apps." + clientId.removeSuffix(SUFFIX)
    private val redirectUri: String get() = "$scheme:/oauth2redirect"

    fun isRedirect(uri: Uri?): Boolean = uri != null && isConfigured && uri.scheme == scheme && uri.path == "/oauth2redirect"

    private fun rnd(n: Int): String {
        val b = ByteArray(n)
        SecureRandom().nextBytes(b)
        return Base64.encodeToString(b, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    /** Opens the Google consent page in the system browser. The answer arrives in [handleRedirect]. */
    fun start(ctx: Context, requestId: Int, scopes: String) {
        val verifier = rnd(48)
        val state = rnd(18)
        val challenge = Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray()), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        // kept in private preferences so the sign-in survives the app being recreated while the browser is open
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt("id", requestId).putString("verifier", verifier).putString("state", state).apply()
        val uri = Uri.parse("https://accounts.google.com/o/oauth2/v2/auth").buildUpon()
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("redirect_uri", redirectUri)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("scope", scopes)
            .appendQueryParameter("code_challenge", challenge)
            .appendQueryParameter("code_challenge_method", "S256")
            .appendQueryParameter("state", state)
            .appendQueryParameter("prompt", "select_account")
            .build()
        ctx.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** deliver(requestId, ok, payload): payload is {"accessToken","expiresIn"} JSON on success, a message on failure. */
    fun handleRedirect(ctx: Context, uri: Uri, deliver: (Int, Boolean, String) -> Unit) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val id = p.getInt("id", 0)
        val verifier = p.getString("verifier", null)
        val state = p.getString("state", null)
        p.edit().clear().apply() // one use only
        val error = uri.getQueryParameter("error")
        val code = uri.getQueryParameter("code")
        if (verifier == null || id == 0) return deliver(id, false, "Phiên đăng nhập không còn hiệu lực.")
        if (error != null) return deliver(id, false, error)
        if (code == null || uri.getQueryParameter("state") != state) return deliver(id, false, "Phản hồi đăng nhập không hợp lệ.")
        Thread {
            try {
                val body = "client_id=${enc(clientId)}&code=${enc(code)}&code_verifier=${enc(verifier)}&grant_type=authorization_code&redirect_uri=${enc(redirectUri)}"
                val json = post("https://oauth2.googleapis.com/token", body)
                val token = json.optString("access_token")
                if (token.isEmpty()) deliver(id, false, json.optString("error_description", "Không nhận được mã truy cập."))
                else deliver(id, true, JSONObject().put("accessToken", token).put("expiresIn", json.optInt("expires_in", 3300)).toString())
            } catch (e: Exception) {
                deliver(id, false, "Không kết nối được tới Google.")
            }
        }.start()
    }

    fun revoke(token: String) {
        Thread {
            try {
                post("https://oauth2.googleapis.com/revoke", "token=${enc(token)}")
            } catch (_: Exception) {
                // offline: the token expires by itself
            }
        }.start()
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun post(url: String, form: String): JSONObject {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = "POST"
        c.doOutput = true
        c.connectTimeout = 15000
        c.readTimeout = 20000
        c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
        c.outputStream.use { it.write(form.toByteArray()) }
        val stream = if (c.responseCode in 200..299) c.inputStream else c.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: "{}"
        return try { JSONObject(text) } catch (_: Exception) { JSONObject() }
    }
}
