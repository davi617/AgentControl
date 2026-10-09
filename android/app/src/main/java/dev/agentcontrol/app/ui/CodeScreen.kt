package dev.agentcontrol.app.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import dev.agentcontrol.app.data.JarvisApi
import kotlinx.coroutines.launch

/**
 * Código ao vivo no celular (v4.0, no lugar do Modo Prédio): a mesma aba "Código" da sala do PC, sem a barra da sala
 * (?embed=1). Mostra cada agente pelo nome, os arquivos que ele está mudando e o diff.
 *
 * Entrada: o app troca o token por uma SESSÃO do navegador (/api/login, igual ao iPhone) e passa o cookie para este
 * WebView. Antes ia o token cru num cookie ac_token, que o servidor deixou de aceitar na 3.1 (a tela caía no login).
 * A sessão fica guardada no WebView; se o dono desconectar o aparelho, a página cai em /entrar e o app entra de novo.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun CodeScreen(baseUrl: String, token: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val cookies = remember { CookieManager.getInstance().apply { setAcceptCookie(true) } }
    val page = "$baseUrl/?embed=1#codigo"
    val retried = remember { booleanArrayOf(false) }

    suspend fun login() {
        runCatching { JarvisApi(baseUrl, token).webSession() }.onSuccess { cookies.setCookie(baseUrl, it); cookies.flush() }
    }

    val web = remember {
        WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = true
            setBackgroundColor(android.graphics.Color.parseColor("#090909"))
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url.toString()
                    if (url.startsWith(baseUrl)) return false
                    runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                    return true
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    // Sessão vencida ou desconectada pelo dono: entra de novo uma vez (sem pedir o token).
                    if (url?.contains("/entrar") == true && !retried[0]) {
                        retried[0] = true
                        scope.launch { login(); view.loadUrl(page) }
                    }
                }
            }
        }
    }
    LaunchedEffect(web) {
        if (cookies.getCookie(baseUrl)?.contains("ac_session=") != true) login()
        web.loadUrl(page)
    }
    DisposableEffect(web) { onDispose { web.stopLoading(); web.destroy() } }
    AndroidView(factory = { web }, modifier = Modifier.fillMaxSize())
}
