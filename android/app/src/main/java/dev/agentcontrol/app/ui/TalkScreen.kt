package dev.agentcontrol.app.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import dev.agentcontrol.app.TalkUi

/** Falar com o JARVIS: um toque, você fala, ele responde em voz. Como um assistente, mas com o estado real do time. */
@Composable
fun TalkScreen(t: TalkUi, start: () -> Unit, stop: () -> Unit, continuous: (Boolean) -> Unit) {
    val k = Clay.c
    val ctx = LocalContext.current
    val mic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) start() }
    val active = t.state != "parado"
    val pulse by rememberInfiniteTransition(label = "orb").animateFloat(
        1f, if (active) 1.08f else 1f, infiniteRepeatable(tween(if (t.state == "falando") 420 else 900), RepeatMode.Reverse), label = "pulse",
    )
    val list = rememberLazyListState()
    LaunchedEffect(t.turns.size) { if (t.turns.isNotEmpty()) list.animateScrollToItem(t.turns.size - 1) }

    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = list, contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (t.turns.isEmpty()) item {
                Text(
                    "Toque no círculo e fale.\nEx.: \"como está o time?\", \"o Hermes terminou?\", \"Claude, roda os testes da API\".",
                    color = k.muted, fontSize = 15.sp, lineHeight = 22.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
                )
            }
            items(t.turns) { (who, text) ->
                val me = who == "DONO"
                Row(Modifier.fillMaxWidth(), horizontalArrangement = if (me) Arrangement.End else Arrangement.Start) {
                    Text(
                        text, color = if (me) k.text else k.text2, fontSize = 15.sp, lineHeight = 22.sp,
                        modifier = Modifier.fillMaxWidth(.85f).clay(androidx.compose.foundation.shape.RoundedCornerShape(20.dp), elevation = if (me) 6.dp else 3.dp, color = if (me) k.brandSoft else null).padding(14.dp),
                    )
                }
            }
        }
        Text(
            when (t.state) {
                "ouvindo" -> t.partial.ifEmpty { "Ouvindo…" }
                "pensando" -> "JARVIS pensando…"
                "falando" -> "JARVIS falando"
                else -> "Toque para falar"
            },
            color = if (active) k.text else k.muted, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
        )
        Box(
            Modifier.padding(12.dp).size(128.dp).scale(pulse)
                .clay(CircleShape, elevation = 16.dp, color = when (t.state) { "ouvindo" -> k.ok; "parado" -> k.brand; else -> k.brandSoft })
                .border(3.dp, k.brand.copy(alpha = if (active) .9f else .3f), CircleShape)
                .clickable {
                    if (active) stop()
                    else if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start()
                    else mic.launch(Manifest.permission.RECORD_AUDIO)
                }
                .semantics { contentDescription = if (active) "Parar" else "Falar com o JARVIS" },
            contentAlignment = Alignment.Center,
        ) { Icon(if (active) Icons.Outlined.Stop else Icons.Outlined.Mic, null, tint = if (t.state == "parado") k.onBrand else k.text, modifier = Modifier.size(46.dp)) }
        Row(Modifier.padding(bottom = 18.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Conversa contínua", color = k.text, fontSize = 14.sp)
            Switch(checked = t.continuous, onCheckedChange = continuous)
        }
    }
}
