package dev.agentcontrol.app.ui

import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.agentcontrol.app.BrainUi
import dev.agentcontrol.app.data.Note
import dev.agentcontrol.app.data.NoteHit

/** Cérebro: o vault do Obsidian no bolso. Busca por título/conteúdo, lê a nota e segue os [[links]]. */
@Composable
fun BrainScreen(b: BrainUi, search: (String) -> Unit, open: (String) -> Unit, back: () -> Unit, favorites: List<dev.agentcontrol.app.data.Favorite> = emptyList(), toggleFavorite: (String, String) -> Unit = { _, _ -> }, share: (String, String) -> Unit = { _, _ -> }) {
    LaunchedEffect(Unit) { if (b.result == null) search("") }
    val note = b.note
    if (note != null) {
        BackHandler(onBack = back)
        NoteView(note, open, back, favorite = favorites.any { it.path == note.path }, toggleFavorite = { toggleFavorite(note.path, note.title) }, share = { share(note.title, note.text) })
        return
    }
    val k = Clay.c
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.padding(14.dp).fillMaxWidth().heightIn(min = 52.dp).clayWell(RoundedCornerShape(26.dp)).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Outlined.Search, null, tint = k.muted, modifier = Modifier.size(20.dp))
            Box(Modifier.weight(1f)) {
                if (b.query.isEmpty()) Text("Buscar no cérebro…", color = k.muted, fontSize = 15.sp)
                BasicTextField(b.query, search, singleLine = true, textStyle = TextStyle(color = k.text, fontSize = 15.sp), cursorBrush = SolidColor(k.brand), modifier = Modifier.fillMaxWidth())
            }
        }
        val r = b.result
        Text(
            when {
                b.loading && r == null -> "Abrindo o cérebro…"
                r == null -> ""
                b.query.isBlank() -> "${r.total} notas no vault · mexidas por último"
                else -> "${r.hits.size} resultado(s) em ${r.total} notas"
            },
            color = k.muted, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 22.dp),
        )
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Favoritos no topo quando não tem busca.
            if (b.query.isBlank() && favorites.isNotEmpty()) {
                item { SectionTitle("Favoritos") }
                items(favorites, key = { "f-" + it.path }) { f -> HitRow(NoteHit(f.path, f.title, f.path.substringBeforeLast('/', "")), ) { open(f.path) } }
                item { SectionTitle("Mexidas por último") }
            }
            if (r != null && r.hits.isEmpty()) item { Text("Nada encontrado. Tente outra palavra.", color = k.muted, modifier = Modifier.padding(8.dp)) }
            items(r?.hits.orEmpty(), key = { it.path }) { h -> HitRow(h) { open(h.path) } }
        }
    }
}

@Composable
private fun HitRow(h: NoteHit, onClick: () -> Unit) {
    val k = Clay.c
    Row(
        Modifier.fillMaxWidth().clay(RoundedCornerShape(18.dp), elevation = 4.dp).clickable(onClick = onClick).padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(Icons.Outlined.Description, null, tint = k.brandText, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(h.title, color = k.text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 2)
            if (h.folder.isNotEmpty()) Text(h.folder, color = k.muted, fontSize = 11.sp, fontFamily = FontFamily.Monospace, maxLines = 1)
            if (h.snippet.isNotEmpty()) Text("…${h.snippet}…", color = k.text2, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 3)
        }
    }
}

@Composable
private fun NoteView(n: Note, open: (String) -> Unit, back: () -> Unit, favorite: Boolean = false, toggleFavorite: () -> Unit = {}, share: () -> Unit = {}) {
    val k = Clay.c
    // Markdown simples: some o frontmatter; títulos, listas e citações ganham estilo; [[link]] vira texto.
    val lines = n.text.replace(Regex("^---[\\s\\S]*?\\n---\\s*"), "").lines()
        .map { it.replace(Regex("\\[\\[([^\\]|]+)\\|?([^\\]]*)]]")) { m -> m.groupValues[2].ifEmpty { m.groupValues[1] } }.replace("**", "") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                ClayIconButton(back, "Voltar") { Icon(Icons.AutoMirrored.Outlined.ArrowBack, null, tint = k.text) }
                Column(Modifier.weight(1f)) {
                    Text(n.title, color = k.text, fontWeight = FontWeight.Bold, fontSize = 19.sp)
                    Text(n.path, color = k.muted, fontSize = 11.sp, fontFamily = FontFamily.Monospace, maxLines = 1)
                }
                ClayIconButton(share, "Compartilhar a nota") { androidx.compose.material3.Icon(Icons.Outlined.Share, null, tint = k.text) }
                ClayIconButton(toggleFavorite, if (favorite) "Tirar dos favoritos" else "Favoritar") { androidx.compose.material3.Icon(if (favorite) Icons.Filled.Star else Icons.Outlined.StarBorder, null, tint = if (favorite) k.brandText else k.text) }
            }
        }
        items(lines.size) { i ->
            val l = lines[i]
            when {
                l.isBlank() -> Box(Modifier.size(4.dp))
                l.startsWith("#") -> {
                    val level = l.takeWhile { it == '#' }.length
                    Text(l.trimStart('#').trim(), color = k.text, fontWeight = FontWeight.Bold, fontSize = (22 - level * 2).coerceAtLeast(15).sp, modifier = Modifier.padding(top = 8.dp))
                }
                l.trimStart().startsWith("- ") || l.trimStart().startsWith("* ") ->
                    Text("•  " + l.trimStart().drop(2), color = k.text2, fontSize = 14.5.sp, lineHeight = 21.sp, modifier = Modifier.padding(start = (l.length - l.trimStart().length).coerceAtMost(12).dp * 2))
                l.startsWith(">") -> Text(l.trimStart('>').trim(), color = k.muted, fontSize = 14.sp, lineHeight = 20.sp, modifier = Modifier.padding(start = 10.dp))
                l.startsWith("|") -> Text(l, color = k.text2, fontSize = 12.sp, fontFamily = FontFamily.Monospace)
                else -> Text(l, color = k.text2, fontSize = 14.5.sp, lineHeight = 21.sp)
            }
        }
        if (n.links.isNotEmpty()) {
            item { SectionTitle("Ligações desta nota") }
            items(n.links, key = { "l-$it" }) { l ->
                Text(
                    l.substringAfterLast('/').removeSuffix(".md"), color = k.brandText, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    modifier = Modifier.fillMaxWidth().clay(RoundedCornerShape(14.dp), elevation = 3.dp).clickable { open(l) }.padding(12.dp),
                )
            }
        }
    }
}
