package dev.agentcontrol.app

import android.app.Activity
import android.app.KeyguardManager
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.CancellationSignal

/**
 * Digital, rosto ou PIN do celular antes de aprovar um comando protegido (v4.0).
 * API do próprio Android (10+), sem biblioteca a mais. Celular sem tela de bloqueio ou Android 8/9: segue direto,
 * como antes (não há o que conferir). A ação "Aprovar" da notificação já pede desbloquear a tela.
 */
object Biometric {
    fun confirm(activity: Activity?, title: String, subtitle: String, onOk: () -> Unit, onFail: (String) -> Unit) {
        if (activity == null || Build.VERSION.SDK_INT < 29) { onOk(); return }
        val km = activity.getSystemService(KeyguardManager::class.java)
        if (km?.isDeviceSecure != true) { onOk(); return }
        val b = BiometricPrompt.Builder(activity).setTitle(title).setSubtitle(subtitle)
        if (Build.VERSION.SDK_INT >= 30) {
            b.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.DEVICE_CREDENTIAL)
        } else {
            @Suppress("DEPRECATION")
            b.setDeviceCredentialAllowed(true)
        }
        b.build().authenticate(CancellationSignal(), activity.mainExecutor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult?) { onOk() }
            override fun onAuthenticationError(errorCode: Int, errString: CharSequence?) { onFail(errString?.toString() ?: "cancelado") }
        })
    }
}
