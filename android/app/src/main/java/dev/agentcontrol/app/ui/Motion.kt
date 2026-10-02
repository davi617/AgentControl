package dev.agentcontrol.app.ui

import android.provider.Settings
import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Easing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlin.math.pow
import kotlin.math.roundToInt

// Movimento do app inspirado no anime.js (animejs.com, fonte de design do vault): curva outExpo,
// entrada escalonada (stagger), mola no toque (spring) e número que conta subindo.
// Regra do vault (ARCHITECTURE.md): animação curta, funcional e respeitando "remover animações" do Android.

/** outExpo do anime.js: sai rápido e assenta suave. */
val OutExpo = Easing { t -> if (t >= 1f) 1f else 1f - 2f.pow(-10f * t) }

/** Android com "Remover animações" ligado (acessibilidade/opções do desenvolvedor): tudo aparece direto. */
@Composable
fun reducedMotion(): Boolean {
    val ctx = LocalContext.current
    return remember { runCatching { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false) }
}

/** Entrada escalonada (stagger): o item [index] sobe 14 dp e aparece, [step] ms depois do anterior. */
@Composable
fun Modifier.staggerIn(index: Int, step: Long = 45L): Modifier {
    val reduced = reducedMotion()
    val p = remember { Animatable(if (reduced) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (!reduced) { delay(index.coerceAtMost(12) * step); p.animateTo(1f, tween(520, easing = OutExpo)) }
    }
    return this.graphicsLayer { alpha = p.value; translationY = (1f - p.value) * 14.dp.toPx() }
}

/** Toque com mola: o cartão afunda um pouco e volta quicando de leve (spring do anime.js). */
@Composable
fun Modifier.springClick(enabled: Boolean = true, onClick: () -> Unit): Modifier {
    val src = remember { MutableInteractionSource() }
    val pressed by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (pressed) 0.96f else 1f, spring(dampingRatio = 0.45f, stiffness = 700f), label = "mola")
    return this.graphicsLayer { scaleX = s; scaleY = s }.clickable(interactionSource = src, indication = null, enabled = enabled, onClick = onClick)
}

/** Número que conta de 0 até [target] (efeito clássico do anime.js nos contadores). */
@Composable
fun countUp(target: Float, durationMs: Int = 900): Float {
    val reduced = reducedMotion()
    val a = remember { Animatable(if (reduced) target else 0f) }
    LaunchedEffect(target) { if (reduced) a.snapTo(target) else a.animateTo(target, tween(durationMs, easing = OutExpo)) }
    return a.value
}

@Composable
fun countUp(target: Int): Int = countUp(target.toFloat()).roundToInt()

/** Valor de 0 a 1 que enche uma vez ao aparecer (barra de progresso). */
@Composable
fun fillIn(target: Float): Float = countUp(target, 1100)

/** Troca de tela: a nova aparece subindo um pouco (outExpo), a antiga some rápido. */
fun AnimatedContentTransitionScope<Screen>.screenTransition(reduced: Boolean): ContentTransform =
    if (reduced) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
    else (fadeIn(tween(220)) + slideInVertically(tween(320, easing = OutExpo)) { it / 28 }) togetherWith fadeOut(tween(110))
