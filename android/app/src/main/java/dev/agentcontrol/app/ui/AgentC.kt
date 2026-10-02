package dev.agentcontrol.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * AgentC, o mascote e logo do Agent Control (2026-10-01): hexágono com dois olhos em pílula.
 * Minimalista: só pisca e olha em volta de vez em quando. [stroke] muda com o estado (laranja, âmbar, cinza).
 */
@Composable
fun AgentC(size: Dp, modifier: Modifier = Modifier, stroke: Color? = null, alive: Boolean = true) {
    val k = Clay.c
    val reduced = reducedMotion()
    val blink = remember { Animatable(1f) }
    val lookX = remember { Animatable(0f) }
    val lookY = remember { Animatable(0f) }
    if (alive && !reduced) {
        LaunchedEffect(Unit) {
            while (true) {
                delay(Random.nextLong(2400, 5600))
                blink.animateTo(.1f, tween(70)); blink.animateTo(1f, tween(110))
                if (Random.nextFloat() < .2f) { delay(90); blink.animateTo(.1f, tween(70)); blink.animateTo(1f, tween(110)) }
            }
        }
        LaunchedEffect(Unit) {
            while (true) {
                delay(Random.nextLong(1600, 4000))
                val center = Random.nextFloat() < .35f
                val tx = if (center) 0f else Random.nextInt(-3, 4).toFloat()
                val ty = if (center) 0f else Random.nextInt(-2, 3).toFloat()
                launch { lookX.animateTo(tx, tween(260, easing = OutExpo)) }
                lookY.animateTo(ty, tween(260, easing = OutExpo))
            }
        }
    }
    val line = stroke ?: k.brand
    val fill = k.surface
    val eye = if (alive) k.text else k.muted
    Canvas(modifier.size(size)) {
        val s = this.size.minDimension
        val c = Offset(this.size.width / 2, this.size.height / 2)
        val sw = (s / 22f).coerceAtLeast(1.5f)
        val r = s / 2 - sw
        val hex = Path().apply {
            for (i in 0 until 6) {
                val a = Math.toRadians((60.0 * i - 90.0))
                val p = Offset(c.x + r * cos(a).toFloat(), c.y + r * sin(a).toFloat())
                if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y)
            }
            close()
        }
        drawPath(hex, fill)
        drawPath(hex, line, style = Stroke(width = sw, join = StrokeJoin.Round))
        // Olhos em pílula; piscar = achatar na altura; olhar = deslocar um pouco.
        val unit = s / 64f
        val ew = 8f * unit
        val eh = 15f * unit * (if (alive) blink.value else .2f)
        val dx = lookX.value * unit
        val dy = lookY.value * unit
        for (x in listOf(c.x - 12f * unit, c.x + 4f * unit)) {
            drawRoundRect(eye, topLeft = Offset(x + dx, c.y - eh / 2 + dy), size = Size(ew, eh), cornerRadius = CornerRadius(ew / 2, ew / 2))
        }
    }
}
