package app.mangalingo

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.WindowInsets
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import org.json.JSONObject

/**
 * The app screen: the LingoLens web UI (home switch, lookup, vocabulary, settings – the same React
 * code as the browser extension) in a WebView, served from the APK's assets. The JS bridge
 * `MangaLingoNative` controls the floating button and the permissions it needs.
 */
class MainActivity : Activity() {

    companion object {
        const val EXTRA_TAB = "tab"
        private const val ORIGIN = "https://appassets.androidplatform.net"
        private const val INDEX = "$ORIGIN/assets/web/index.html"
        private val TABS = setOf("home", "lookup", "vocab", "settings")
    }

    private lateinit var web: WebView

    /** On-device EN → VI translator (ML Kit). */
    private val translator by lazy {
        Translation.getClient(
            TranslatorOptions.Builder().setSourceLanguage(TranslateLanguage.ENGLISH).setTargetLanguage(TranslateLanguage.VIETNAMESE).build(),
        )
    }

    /** Answers a machine-translation request of the page (see src/mobile/native.ts). */
    private fun mtReply(id: Int, ok: Boolean, text: String) {
        runOnUiThread { web.evaluateJavascript("window.__mlMt && window.__mlMt($id, $ok, ${JSONObject.quote(text)});", null) }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true // vocabulary + settings live in localStorage
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            setBackgroundColor(getColor(R.color.bg))
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)

                // Links (sources, licences) open in the browser, never inside the app.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url
                    if (url.host == Uri.parse(ORIGIN).host) return false
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    return true
                }
            }
            addJavascriptInterface(Bridge(), "MangaLingoNative")
        }
        // Android 15 draws apps edge to edge: a container keeps the UI clear of the status /
        // navigation bars (padding on the WebView itself does not move its content).
        val root = FrameLayout(this).apply { setBackgroundColor(getColor(R.color.bg)) }
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        web.loadUrl("$INDEX#${tabOf(intent)}")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val tab = tabOf(intent)
        web.evaluateJavascript("location.hash = '$tab';", null)
    }

    override fun onResume() {
        super.onResume()
        // Coming back from the "display over other apps" screen: start the button if it was requested.
        if (Prefs.wantOn(this) && Settings.canDrawOverlays(this)) {
            Prefs.setWantOn(this, false)
            Prefs.setEnabled(this, true)
            BubbleService.start(this)
        } else if (Prefs.enabled(this) && Settings.canDrawOverlays(this) && !BubbleService.running) {
            BubbleService.start(this)
        }
        web.evaluateJavascript("window.__mlOnResume && window.__mlOnResume();", null)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private fun tabOf(i: Intent?): String = i?.getStringExtra(EXTRA_TAB)?.takeIf { it in TABS } ?: "home"

    /** Methods callable from the web UI (`window.MangaLingoNative`). Run on a binder thread. */
    inner class Bridge {
        @JavascriptInterface
        fun overlayAllowed(): Boolean = Settings.canDrawOverlays(this@MainActivity)

        @JavascriptInterface
        fun openOverlaySettings() {
            Prefs.setWantOn(this@MainActivity, true)
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }

        @JavascriptInterface
        fun setEnabled(on: Boolean): Boolean {
            val ctx = this@MainActivity
            if (on && !Settings.canDrawOverlays(ctx)) {
                openOverlaySettings()
                return false
            }
            Prefs.setEnabled(ctx, on)
            Prefs.setWantOn(ctx, false)
            if (on) BubbleService.start(ctx) else BubbleService.stop(ctx)
            return on
        }

        @JavascriptInterface
        fun isEnabled(): Boolean = Prefs.enabled(this@MainActivity) && Settings.canDrawOverlays(this@MainActivity)

        /** Logo chosen in Settings → Giao diện: enables that launcher entry (icon), disables the others. */
        @JavascriptInterface
        fun setLogo(id: String): Boolean {
            val ids = listOf("glass", "clear", "oil", "sunset", "clay", "ink")
            if (id !in ids) return false
            val pm = packageManager
            for (other in ids) {
                val component = ComponentName(packageName, "$packageName.Launcher${other.replaceFirstChar { it.uppercase() }}")
                val state = if (other == id) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
                if (pm.getComponentEnabledSetting(component) != state) pm.setComponentEnabledSetting(component, state, PackageManager.DONT_KILL_APP)
            }
            return true
        }

        /** Machine translation. op: "status" → installed | download, "prepare" → downloads the model, "translate". Answer comes through window.__mlMt(id, ok, text). */
        @JavascriptInterface
        fun mt(id: Int, op: String, text: String) {
            val model = TranslateRemoteModel.Builder(TranslateLanguage.VIETNAMESE).build()
            when (op) {
                "status" -> RemoteModelManager.getInstance().isModelDownloaded(model)
                    .addOnSuccessListener { mtReply(id, true, if (it) "installed" else "download") }
                    .addOnFailureListener { mtReply(id, false, it.message ?: "status") }
                "prepare" -> translator.downloadModelIfNeeded(DownloadConditions.Builder().build())
                    .addOnSuccessListener { mtReply(id, true, "installed") }
                    .addOnFailureListener { mtReply(id, false, it.message ?: "download") }
                "translate" -> translator.downloadModelIfNeeded(DownloadConditions.Builder().build())
                    .onSuccessTask { translator.translate(text) }
                    .addOnSuccessListener { mtReply(id, true, it) }
                    .addOnFailureListener { mtReply(id, false, it.message ?: "translate") }
                else -> mtReply(id, false, "unknown op")
            }
        }

        @JavascriptInterface
        fun notificationsAllowed(): Boolean =
            Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

        @JavascriptInterface
        fun requestNotifications() {
            if (Build.VERSION.SDK_INT >= 33) runOnUiThread { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1) }
        }
    }

}
