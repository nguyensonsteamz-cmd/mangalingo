package app.mangalingo

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The floating MangaLingo button (like iOS AssistiveTouch), shown over other apps while the switch
 * on the home screen is on. Drag it anywhere; on release it sticks to the nearer side edge; when it
 * is not used for a moment it fades. Tap → menu with the app's features.
 */
class BubbleService : Service() {

    companion object {
        const val ACTION_STOP = "app.mangalingo.STOP"
        private const val CHANNEL = "bubble"
        private const val NOTIFICATION_ID = 1
        private const val IDLE_MS = 2500L
        private const val IDLE_ALPHA = 0.45f

        @Volatile
        var running = false
            private set

        fun start(c: Context) {
            val i = Intent(c, BubbleService::class.java)
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i) else c.startService(i)
        }

        fun stop(c: Context) {
            c.stopService(Intent(c, BubbleService::class.java))
        }
    }

    private lateinit var wm: WindowManager
    private var bubble: View? = null
    private var menu: View? = null
    private lateinit var params: WindowManager.LayoutParams
    private val handler = Handler(Looper.getMainLooper())
    private val fade = Runnable { bubble?.animate()?.alpha(IDLE_ALPHA)?.setDuration(350)?.start() }
    private var snapAnim: ValueAnimator? = null

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        startInForeground()
        if (Settings.canDrawOverlays(this)) addBubble() else stopSelf()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Prefs.setEnabled(this, false)
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        handler.removeCallbacksAndMessages(null)
        snapAnim?.cancel()
        hideMenu()
        bubble?.let { runCatching { wm.removeView(it) } }
        bubble = null
        super.onDestroy()
    }

    // ---------------------------------------------------------------- notification (required)

    private fun startInForeground() {
        val nm = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "Nút nổi MangaLingo", NotificationManager.IMPORTANCE_MIN))
        }
        val stop = PendingIntent.getService(this, 1, Intent(this, BubbleService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val open = PendingIntent.getActivity(this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this))
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("MangaLingo đang bật")
            .setContentText("Chạm nút nổi trên màn hình để dùng.")
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null, "Tắt", stop).build())
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(NOTIFICATION_ID, n)
    }

    // ---------------------------------------------------------------- the button

    private fun screenSize(): Pair<Int, Int> {
        if (Build.VERSION.SDK_INT >= 30) {
            val b = wm.currentWindowMetrics.bounds
            return b.width() to b.height()
        }
        val m = resources.displayMetrics
        return m.widthPixels to m.heightPixels
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun addBubble() {
        val size = dp(56f)
        val margin = dp(4f)
        val (sw, sh) = screenSize()
        params = WindowManager.LayoutParams(
            size, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = Prefs.bubbleX(this@BubbleService, sw - size - margin)
            y = BubbleMath.clampY(Prefs.bubbleY(this@BubbleService, sh / 3), size, sh, dp(24f), dp(48f))
        }
        val v = AssistiveButton(this)
        v.contentDescription = "MangaLingo"
        val slop = ViewConfiguration.get(this).scaledTouchSlop
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        v.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    wake()
                    snapAnim?.cancel()
                    downX = e.rawX; downY = e.rawY
                    startX = params.x; startY = params.y
                    dragging = false
                    v.animate().scaleX(0.92f).scaleY(0.92f).setDuration(80).start()
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (!dragging && BubbleMath.isDrag(dx, dy, slop)) dragging = true
                    if (dragging) {
                        params.x = (startX + dx).toInt()
                        params.y = (startY + dy).toInt()
                        runCatching { wm.updateViewLayout(v, params) }
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    v.animate().scaleX(1f).scaleY(1f).setDuration(80).start()
                    if (dragging) snapToEdge() else if (e.actionMasked == MotionEvent.ACTION_UP) showMenu()
                    scheduleFade()
                }
            }
            true
        }
        wm.addView(v, params)
        bubble = v
        scheduleFade()
    }

    private fun wake() {
        handler.removeCallbacks(fade)
        bubble?.animate()?.alpha(1f)?.setDuration(120)?.start()
    }

    private fun scheduleFade() {
        handler.removeCallbacks(fade)
        handler.postDelayed(fade, IDLE_MS)
    }

    private fun snapToEdge() {
        val v = bubble ?: return
        val (sw, sh) = screenSize()
        val size = params.width
        params.y = BubbleMath.clampY(params.y, size, sh, dp(24f), dp(48f))
        val target = BubbleMath.snapX(params.x, size, sw, dp(4f))
        snapAnim = ValueAnimator.ofInt(params.x, target).apply {
            duration = 220
            interpolator = DecelerateInterpolator()
            addUpdateListener {
                params.x = it.animatedValue as Int
                runCatching { wm.updateViewLayout(v, params) }
            }
            start()
        }
        Prefs.saveBubble(this, target, params.y)
    }

    // ---------------------------------------------------------------- the menu

    private data class Item(val icon: Int, val label: String, val action: () -> Unit)

    private fun menuItems() = listOf(
        Item(R.drawable.ic_search, "Tra cứu") { openApp("lookup") },
        Item(R.drawable.ic_bookmark, "Sổ từ") { openApp("vocab") },
        Item(R.drawable.ic_settings, "Cài đặt") { openApp("settings") },
        Item(R.drawable.ic_home, "Mở app") { openApp("home") },
        Item(R.drawable.ic_power, "Tắt") {
            Prefs.setEnabled(this, false)
            stopSelf()
        },
    )

    private fun openApp(tab: String) {
        startActivity(
            Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_TAB, tab)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
    }

    private fun showMenu() {
        if (menu != null) return hideMenu()
        bubble?.visibility = View.INVISIBLE
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.argb(110, 0, 0, 0))
            setOnClickListener { hideMenu() } // tap outside the panel closes the menu
            alpha = 0f
        }
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = GradientDrawable().apply {
                cornerRadius = dp(28f).toFloat()
                setColor(Color.argb(235, 28, 32, 44))
            }
            setPadding(dp(14f), dp(14f), dp(14f), dp(14f))
            isClickable = true // taps on the panel's padding do not close the menu
        }
        val items = menuItems()
        items.chunked(3).forEach { rowItems ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            rowItems.forEach { item -> row.addView(menuButton(item)) }
            panel.addView(row)
        }
        root.addView(panel, FrameLayout.LayoutParams(FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        )
        wm.addView(root, lp)
        root.animate().alpha(1f).setDuration(140).start()
        panel.scaleX = 0.85f
        panel.scaleY = 0.85f
        panel.animate().scaleX(1f).scaleY(1f).setDuration(160).setInterpolator(DecelerateInterpolator()).start()
        menu = root
        handler.removeCallbacks(fade)
    }

    private fun menuButton(item: Item): View {
        val w = dp(84f)
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(w, w)
            background = GradientDrawable().apply {
                cornerRadius = dp(18f).toFloat()
                setColor(Color.TRANSPARENT)
            }
            isClickable = true
            setOnClickListener {
                hideMenu()
                item.action()
            }
            setOnTouchListener { view, e ->
                (view.background as GradientDrawable).setColor(if (e.actionMasked == MotionEvent.ACTION_DOWN) Color.argb(40, 255, 255, 255) else Color.TRANSPARENT)
                false
            }
            addView(ImageView(context).apply {
                setImageResource(item.icon)
                layoutParams = LinearLayout.LayoutParams(dp(30f), dp(30f))
            })
            addView(TextView(context).apply {
                text = item.label
                setTextColor(Color.WHITE)
                textSize = 12.5f
                gravity = Gravity.CENTER
                setPadding(0, dp(6f), 0, 0)
            })
        }
    }

    private fun hideMenu() {
        val m = menu ?: return
        menu = null
        runCatching { wm.removeView(m) }
        bubble?.visibility = View.VISIBLE
        scheduleFade()
    }

    /** iOS-AssistiveTouch-like button: dark rounded square with three concentric light rings. */
    private class AssistiveButton(c: Context) : View(c) {
        private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(215, 26, 28, 36) }
        private val ring = Paint(Paint.ANTI_ALIAS_FLAG)
        private val box = RectF()
        override fun onDraw(canvas: Canvas) {
            val s = width.toFloat()
            box.set(0f, 0f, s, s)
            canvas.drawRoundRect(box, s * 0.28f, s * 0.28f, bg)
            val cx = s / 2
            ring.color = Color.argb(70, 255, 255, 255); canvas.drawCircle(cx, cx, s * 0.36f, ring)
            ring.color = Color.argb(120, 255, 255, 255); canvas.drawCircle(cx, cx, s * 0.27f, ring)
            ring.color = Color.argb(245, 255, 255, 255); canvas.drawCircle(cx, cx, s * 0.18f, ring)
        }
    }
}
