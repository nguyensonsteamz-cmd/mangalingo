package app.mangalingo

import android.content.Context

/** Small persistent state of the native side (switch on/off, button position). */
object Prefs {
    private const val FILE = "mangalingo"
    private fun sp(c: Context) = c.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** The user's switch on the home screen. */
    fun enabled(c: Context) = sp(c).getBoolean("enabled", false)
    fun setEnabled(c: Context, on: Boolean) = sp(c).edit().putBoolean("enabled", on).apply()

    /** Switch was turned on but the overlay permission was missing: start once it is granted. */
    fun wantOn(c: Context) = sp(c).getBoolean("wantOn", false)
    fun setWantOn(c: Context, on: Boolean) = sp(c).edit().putBoolean("wantOn", on).apply()

    fun bubbleX(c: Context, def: Int) = sp(c).getInt("bx", def)
    fun bubbleY(c: Context, def: Int) = sp(c).getInt("by", def)
    fun saveBubble(c: Context, x: Int, y: Int) = sp(c).edit().putInt("bx", x).putInt("by", y).apply()
}
