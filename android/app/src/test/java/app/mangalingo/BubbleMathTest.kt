package app.mangalingo

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BubbleMathTest {
    private val size = 150
    private val screenW = 1080

    @Test
    fun snapsToTheNearerSideEdge() {
        assertEquals(10, BubbleMath.snapX(100, size, screenW, 10)) // left half
        assertEquals(1080 - 150 - 10, BubbleMath.snapX(700, size, screenW, 10)) // right half
        assertEquals(10, BubbleMath.snapX(-80, size, screenW, 10)) // dragged past the left edge
        assertEquals(1080 - 150 - 10, BubbleMath.snapX(2000, size, screenW, 10)) // past the right edge
        // exactly centred → right edge
        assertEquals(1080 - 150 - 10, BubbleMath.snapX(540 - 75, size, screenW, 10))
    }

    @Test
    fun staysOnScreenVertically() {
        assertEquals(60, BubbleMath.clampY(-300, size, 2400, 60, 120))
        assertEquals(2400 - 150 - 120, BubbleMath.clampY(5000, size, 2400, 60, 120))
        assertEquals(800, BubbleMath.clampY(800, size, 2400, 60, 120))
    }

    @Test
    fun smallMovementIsATap() {
        assertFalse(BubbleMath.isDrag(3f, 4f, 8))
        assertTrue(BubbleMath.isDrag(6f, 7f, 8))
    }
}
