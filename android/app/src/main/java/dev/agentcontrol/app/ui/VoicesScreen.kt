package dev.agentcontrol.app.ui

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentcontrol.app.VoiceEngine

/** Vozes: escolher e ouvir a voz de cada agente (pt-BR, as melhores primeiro) e baixar vozes melhores no Android. */
@Composable
fun VoicesScreen(
    list: suspend () -> List<Pair<String, String>>,
    current: (String) -> String?,
    choose: (who: String, voice: String) -> Unit,
    preview: (String) -> Unit,
    install: () -> Unit,
) {
    val k = Clay.c
    var voices by remember { mutableStateOf<List<Pair<String, String>>?>(null) }
    var changed by remember { mutableIntStateOf(0) } // força reler a escolha depois de trocar
    LaunchedEffect(Unit) { voices = list() }
    val who = VoiceEngine.ORDER.filter { it != "DONO" }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 8.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Vozes da chamada", color = k.text, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(
                    when {
                        voices == null -> "Carregando as vozes do celular…"
                        voices!!.isEmpty() -> "Nenhuma voz em português do Brasil instalada. Toque em \"Baixar vozes melhores\"."
                        voices!!.size < 4 -> "Só ${voices!!.size} voz(es) pt-BR no celular: alguns agentes vão dividir voz. Baixe mais vozes para cada um ter a sua."
                        else -> "${voices!!.size} vozes pt-BR. \"online\" = mais natural (precisa de internet)."
                    },
                    color = k.muted, fontSize = 13.sp, lineHeight = 18.sp,
                )
                Box(
                    Modifier.clay(RoundedCornerShape(16.dp), elevation = 5.dp, color = k.brand).clickable(onClick = install).padding(horizontal = 16.dp, vertical = 10.dp),
                ) { Text("Baixar vozes melhores", color = k.onBrand, fontWeight = FontWeight.Bold, fontSize = 14.sp) }
                Text("No Google: Configurações de voz → Português (Brasil) → baixe as vozes de alta qualidade.", color = k.muted, fontSize = 12.sp, lineHeight = 17.sp)
            }
        }
        items(who, key = { it }) { id ->
            val all = voices.orEmpty()
            val cur = remember(changed, voices) { current(id) }
            var open by remember { mutableStateOf(false) }
            Row(
                Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Avatar(id, 36)
                Column(Modifier.weight(1f).clickable(enabled = all.isNotEmpty()) { open = true }) {
                    Text(id, color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Text(all.firstOrNull { it.first == cur }?.second ?: "voz padrão", color = k.brandText, fontSize = 12.sp)
                    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                        all.forEach { (name, label) ->
                            DropdownMenuItem(text = { Text(label) }, onClick = { open = false; choose(id, name); changed++ })
                        }
                    }
                }
                Box(
                    Modifier.size(42.dp).clay(RoundedCornerShape(14.dp), elevation = 5.dp).clickable { preview(id) }.semantics { contentDescription = "Ouvir a voz do $id" },
                    contentAlignment = Alignment.Center,
                ) { Icon(Icons.Outlined.PlayArrow, null, tint = k.text) }
            }
        }
    }
}
