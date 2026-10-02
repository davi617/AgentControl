package dev.agentcontrol.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Estilo clamoryst do Agent Control, com os tokens oficiais de guia de design do Agent Control
 * (CLAY_DARK/CLAY_LIGHT). 2026-09-28 (Dono: "tá feio, deixa profissional"): superfícies planas com borda
 * fina e sombra mínima, laranja #F97316 só na ação principal. Backup do visual anterior: tag git ui-antes-clamoryst.
 */
data class ClayColors(
    val dark: Boolean,
    val bg: Color,
    val surface: Color,
    val well: Color, // campos "afundados"
    val scrim: Color,
    val text: Color,
    val text2: Color,
    val muted: Color,
    val brand: Color,
    val brandText: Color,
    val brandSoft: Color,
    val onBrand: Color,
    val ok: Color,
    val warn: Color,
    val err: Color,
    val shadow: Color,
    val highlight: Color,
    val border: Color = Color(0xFF252525), // contorno dos cartões
)

val ClayLight = ClayColors(
    dark = false,
    bg = Color(0xFFF0EEEB), surface = Color(0xFFFBFAF8), well = Color(0xFFE8E4DF), scrim = Color(0x66000000),
    text = Color(0xFF292B32), text2 = Color(0xFF3F414A), muted = Color(0xFF686972),
    brand = Color(0xFFF97316), brandText = Color(0xFFC2410C), brandSoft = Color(0xFFFDEBDD), onBrand = Color(0xFF0A0A0A),
    ok = Color(0xFF15803D), warn = Color(0xFFB45309), err = Color(0xFFB91C1C),
    shadow = Color(0xFF000000), highlight = Color(0xE6FFFFFF), border = Color(0xFFDDD8D2),
)

val ClayDark = ClayColors(
    dark = true,
    bg = Color(0xFF090909), surface = Color(0xFF111111), well = Color(0xFF181818), scrim = Color(0x99000000),
    text = Color(0xFFF5F5F5), text2 = Color(0xFFE4E4E7), muted = Color(0xFFA1A1AA),
    brand = Color(0xFFF97316), brandText = Color(0xFFFDBA74), brandSoft = Color(0xFF1A120C), onBrand = Color(0xFF0A0A0A),
    ok = Color(0xFF22C55E), warn = Color(0xFFF59E0B), err = Color(0xFFEF4444),
    shadow = Color(0xFF000000), highlight = Color(0x0DFFFFFF), border = Color(0xFF252525),
)

val LocalClay = staticCompositionLocalOf { ClayDark }

/** Atalho: `Clay.c.brand` dentro de qualquer @Composable. */
object Clay {
    val c: ClayColors @Composable get() = LocalClay.current
}

/**
 * Superfície clamoryst: plana, borda fina e sombra quase imperceptível (só para separar camadas).
 * Com [color] (botão de ação, item destacado) fica sem borda. [elevation] alto = um pouco mais de sombra.
 */
@Composable
fun Modifier.clay(shape: Shape, elevation: Dp = 10.dp, color: Color? = null): Modifier {
    val k = Clay.c
    val lift = if (elevation >= 8.dp) 2.dp else 0.dp
    return this
        .then(if (lift > 0.dp) Modifier.shadow(lift, shape, ambientColor = k.shadow.copy(alpha = if (k.dark) .5f else .08f), spotColor = k.shadow.copy(alpha = if (k.dark) .5f else .10f)) else Modifier)
        .background(color ?: k.surface, shape)
        .border(1.dp, if (color == null) k.border else Color.Transparent, shape)
}

/** Campo de entrada (inputs, busca, compositor): um tom acima do fundo, com contorno. */
@Composable
fun Modifier.clayWell(shape: Shape): Modifier {
    val k = Clay.c
    return this
        .background(k.well, shape)
        .border(1.dp, k.border, shape)
}

fun statusColor(status: String?, k: ClayColors): Color {
    val s = status.orEmpty().uppercase()
    return when {
        s.startsWith("DONE") || s.startsWith("APPROVED") -> k.ok
        s.startsWith("WORKING") || s.startsWith("ACK") -> k.brand
        listOf("BLOCKED", "FAILED", "STOPPED", "VIOLATION", "REJECTED", "AWAITING").any { s.startsWith(it) } -> k.err
        listOf("REVIEW", "QUEUED", "ASSIGNED", "NOT_RUN", "NEEDS").any { s.startsWith(it) } -> k.warn
        else -> k.muted
    }
}

/** Cor do avatar derivada do nome (mesma regra da web). */
fun avatarColors(name: String, dark: Boolean): Pair<Color, Color> {
    var h = 0
    for (c in name) h = (h * 31 + c.code) % 360
    return if (dark) Color.hsl(h.toFloat(), 0.30f, 0.18f) to Color.hsl(h.toFloat(), 0.85f, 0.80f)
    else Color.hsl(h.toFloat(), 0.45f, 0.90f) to Color.hsl(h.toFloat(), 0.60f, 0.32f)
}

@Composable
fun JarvisTheme(mode: String = "sistema", fontScale: Float = 1f, content: @Composable () -> Unit) {
    val dark = when (mode) { "claro" -> false; "escuro" -> true; else -> isSystemInDarkTheme() }
    val k = if (dark) ClayDark else ClayLight
    val scheme = if (k.dark) darkColorScheme(
        primary = k.brand, onPrimary = k.onBrand, background = k.bg, onBackground = k.text,
        surface = k.surface, onSurface = k.text, surfaceVariant = k.well, onSurfaceVariant = k.muted, error = k.err,
        surfaceContainerLow = k.bg, surfaceContainer = k.surface, surfaceContainerHigh = k.surface,
    ) else lightColorScheme(
        primary = k.brand, onPrimary = k.onBrand, background = k.bg, onBackground = k.text,
        surface = k.surface, onSurface = k.text, surfaceVariant = k.well, onSurfaceVariant = k.muted, error = k.err,
        surfaceContainerLow = k.bg, surfaceContainer = k.surface, surfaceContainerHigh = k.surface,
    )
    // Tamanho do texto escolhido em Ajustes, por cima do que o celular já usa.
    val d = androidx.compose.ui.platform.LocalDensity.current
    CompositionLocalProvider(LocalClay provides k, androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(d.density, d.fontScale * fontScale)) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
