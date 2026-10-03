package dev.agentcontrol.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Foto de cada agente (robôs da família do AgentC, res/drawable/agent_*.xml). 0 = sem foto (usa as iniciais). */
fun agentPhoto(name: String): Int = when (name.uppercase()) {
    "CLAUDE" -> dev.agentcontrol.app.R.drawable.agent_claude
    "CODEX" -> dev.agentcontrol.app.R.drawable.agent_codex
    "HERMES" -> dev.agentcontrol.app.R.drawable.agent_hermes
    "OPENCODE" -> dev.agentcontrol.app.R.drawable.agent_opencode
    "OPENCLAW" -> dev.agentcontrol.app.R.drawable.agent_openclaw
    "QWEN" -> dev.agentcontrol.app.R.drawable.agent_qwen
    "DROID" -> dev.agentcontrol.app.R.drawable.agent_droid
    "CHATGPT" -> dev.agentcontrol.app.R.drawable.agent_chatgpt
    else -> 0
}

@Composable
fun Avatar(name: String, size: Int = 26) {
    if (name.equals("JARVIS", true)) { AgentC(size.dp); return }
    val photo = agentPhoto(name)
    if (photo != 0) {
        androidx.compose.foundation.Image(
            androidx.compose.ui.res.painterResource(photo), contentDescription = name,
            modifier = Modifier.size(size.dp),
        )
        return
    }
    val (bg, fg) = avatarColors(name, Clay.c.dark)
    Box(
        Modifier.size(size.dp).clay(RoundedCornerShape((size / 3).dp), elevation = 3.dp, color = bg),
        contentAlignment = Alignment.Center,
    ) {
        Text(name.filter { it.isLetterOrDigit() }.take(2).uppercase(), color = fg, fontWeight = FontWeight.Bold, fontSize = (size * 0.38f).sp)
    }
}

/** Selo de status no estilo clay: pastilha tingida, sem borda dura. */
@Composable
fun StatusBadge(status: String?) {
    val k = Clay.c
    val c = statusColor(status, k)
    Text(
        status ?: "sem status",
        color = c, fontSize = 11.sp, fontWeight = FontWeight.Bold,
        modifier = Modifier.background(c.copy(alpha = .14f), RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp),
    )
}

@Composable
fun Dot(color: Color, size: Int = 8) = Box(Modifier.size(size.dp).background(color, CircleShape))

@Composable
fun Mono(text: String, color: Color? = null, size: Int = 12) =
    Text(text, color = color ?: Clay.c.muted, fontFamily = FontFamily.Monospace, fontSize = size.sp)

@Composable
fun SectionTitle(text: String) =
    Text(
        text.uppercase(), color = Clay.c.muted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 1.4.sp,
        modifier = Modifier.padding(start = 6.dp, top = 16.dp, bottom = 6.dp),
    )

@Composable
fun Row2(content: @Composable () -> Unit) =
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { content() }

/** Horário "2026-09-24T04:30:00" → "04:30" (hoje) ou "24/09 04:30". */
fun shortTime(ts: String): String {
    if (ts.length < 16) return ts
    val today = java.time.LocalDate.now().toString()
    val hm = ts.substring(11, 16)
    return if (ts.startsWith(today)) hm else "${ts.substring(8, 10)}/${ts.substring(5, 7)} $hm"
}

/** Saudação do Início, como no app do Claude. */
fun greeting(): String = when (java.time.LocalTime.now().hour) {
    in 0..4 -> "Boa madrugada"
    in 5..11 -> "Bom dia"
    in 12..17 -> "Boa tarde"
    else -> "Boa noite"
}

/** "2026-10-03T09:12:00" → "há 5 min", "há 2 h", "há 3 d" (vazio se não entender). */
fun ago(ts: String?): String {
    if (ts.isNullOrBlank()) return ""
    val t = runCatching { java.time.LocalDateTime.parse(ts.take(19)) }.getOrNull() ?: return ""
    val min = java.time.Duration.between(t, java.time.LocalDateTime.now()).toMinutes()
    return when { min < 1 -> "agora"; min < 60 -> "há $min min"; min < 60 * 24 -> "há ${min / 60} h"; else -> "há ${min / 1440} d" }
}
