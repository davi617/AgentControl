package dev.agentcontrol.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentcontrol.app.UiState

private val ROLES = listOf("membro" to "Membro: fala e manda ordem", "leitura" to "Só leitura: só acompanha", "dono" to "Dono: tudo, inclusive aprovar")

/**
 * Modo Time (2026-10-03): quem trabalha junto com você e os agentes. Mostra quem está online agora;
 * o dono convida (o acesso sai uma vez, pelo compartilhar) e remove (o acesso para de valer na hora).
 */
@Composable
fun TeamScreen(ui: UiState, watch: (() -> Boolean) -> Unit, invite: (String, String) -> Unit, remove: (String) -> Unit) {
    val k = Clay.c
    var open by remember { mutableStateOf(true) }
    DisposableEffect(Unit) { watch { open }; onDispose { open = false } }
    val team = ui.team
    var name by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("membro") }
    var confirm by remember { mutableStateOf<String?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text("Pessoas e agentes trabalhando juntos. Cada pessoa entra com um acesso só dela e fala com o próprio nome na sala e na chamada.", color = k.muted, fontSize = 13.sp)
        }
        if (team == null) item { Text("Atualize o servidor do PC para usar o Modo Time.", color = k.warn, fontSize = 14.sp) }
        else {
            val online = team.people.count { it.online }
            item { SectionTitle("No time · $online online agora") }
            items(team.people, key = { it.id }) { p ->
                val me = p.id == team.me.id
                Row(
                    Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 2.dp).padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box {
                        Box(Modifier.size(38.dp).background(runCatching { Color(android.graphics.Color.parseColor(p.color)) }.getOrDefault(k.brand), CircleShape), contentAlignment = Alignment.Center) {
                            Text(p.name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        }
                        Box(Modifier.align(Alignment.BottomEnd).size(12.dp).background(if (p.online) k.ok else k.muted, CircleShape))
                    }
                    Column(Modifier.weight(1f)) {
                        Text(if (me) "${p.name} (você)" else p.name, color = k.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                        val seen = when {
                            p.online -> "online agora${p.via?.let { " · $it" } ?: ""}"
                            p.lastSeen != null -> "visto ${ago(p.lastSeen).ifBlank { "antes" }}"
                            else -> "ainda não entrou"
                        }
                        Text("${p.role} · $seen", color = if (p.online) k.ok else k.muted, fontSize = 12.sp)
                    }
                    if (team.me.role == "dono" && !me && p.id != "DONO") {
                        Text(if (confirm == p.id) "Confirmar" else "Remover", color = k.err, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clickable { if (confirm == p.id) { remove(p.id); confirm = null } else confirm = p.id }.padding(6.dp))
                    }
                }
            }
            if (team.me.role == "dono") {
                item { SectionTitle("Convidar alguém") }
                item {
                    Column(Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 2.dp).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).clayWell(RoundedCornerShape(22.dp)).padding(horizontal = 16.dp, vertical = 13.dp)) {
                            if (name.isEmpty()) Text("Nome da pessoa", color = k.muted, fontSize = 15.sp)
                            BasicTextField(name, { name = it.take(40) }, singleLine = true, textStyle = TextStyle(color = k.text, fontSize = 15.sp), cursorBrush = SolidColor(k.brand), modifier = Modifier.fillMaxWidth())
                        }
                        ROLES.forEach { (r, desc) ->
                            Row(Modifier.fillMaxWidth().clickable { role = r }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(18.dp).background(if (role == r) k.brand else k.well, CircleShape))
                                Spacer(Modifier.width(10.dp))
                                Text(desc, color = k.text, fontSize = 14.sp)
                            }
                        }
                        Text("Convidar e compartilhar", color = k.onBrand, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.fillMaxWidth().clay(RoundedCornerShape(22.dp), elevation = 4.dp, color = if (name.isBlank()) k.muted else k.brand)
                                .springClick(enabled = name.isNotBlank()) { invite(name.trim(), role); name = "" }.padding(vertical = 13.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        Text("O acesso aparece uma vez só, no compartilhar. A pessoa precisa estar no seu Tailscale.", color = k.muted, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}
