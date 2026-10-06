package dev.agentcontrol.app.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import java.net.URLEncoder

/**
 * Modo Prédio no celular: a mesma página do PC (aba Prédio da sala), em que cada agente vira um bonequinho andando
 * pelos andares. Entra com o token do app num cookie só deste WebView (HttpOnly no servidor) e abre sem a barra da sala
 * (?embed=1). Links de fora abrem no navegador; nada além do endereço do seu PC carrega aqui.
 * "Meu personagem" pede uma foto: abre a galeria/câmera do celular; a foto é lida na própria página (só as cores
 * vão para o PC).
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PredioScreen(baseUrl: String, token: String) {
    val context = LocalContext.current
    // quem está esperando a foto escolhida (o <input type=file> da página)
    val waiting = remember { arrayOfNulls<ValueCallback<Array<Uri>>>(1) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        waiting[0]?.onReceiveValue(uri?.let { arrayOf(it) })
        waiting[0] = null
    }
    val web = remember {
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setCookie(baseUrl, "ac_token=${URLEncoder.encode(token, "UTF-8")}; Path=/; SameSite=Strict")
            flush()
        }
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
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                    waiting[0]?.onReceiveValue(null)
                    waiting[0] = callback
                    return runCatching { picker.launch("image/*") }.fold(
                        onSuccess = { true },
                        onFailure = { waiting[0] = null; callback.onReceiveValue(null); false },
                    )
                }
            }
            loadUrl("$baseUrl/?embed=1#predio")
        }
    }
    DisposableEffect(web) { onDispose { web.stopLoading(); web.destroy() } }
    AndroidView(factory = { web }, modifier = Modifier.fillMaxSize())
}
