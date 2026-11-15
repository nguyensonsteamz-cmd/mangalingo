package app.mangalingo

/** Pure geometry of the floating button (unit-tested). */
object BubbleMath {
    /**
     * X position after the user lets go: the button sticks to the nearer side edge, like iOS
     * AssistiveTouch. [x] is the button's left edge, [size] its width.
     */
    fun snapX(x: Int, size: Int, screenWidth: Int, margin: Int): Int {
        val centre = x + size / 2
        return if (centre < screenWidth / 2) margin else screenWidth - size - margin
    }

    /** Keeps the button fully on screen vertically (away from status / navigation bars). */
    fun clampY(y: Int, size: Int, screenHeight: Int, top: Int, bottom: Int): Int =
        y.coerceIn(top, maxOf(top, screenHeight - size - bottom))

    /** A touch that moved less than [slop] px is a tap, not a drag. */
    fun isDrag(dx: Float, dy: Float, slop: Int): Boolean = dx * dx + dy * dy > slop.toFloat() * slop
}
