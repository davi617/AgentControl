package dev.agentcontrol.app

import android.Manifest
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import dev.agentcontrol.app.ui.JarvisApp
import dev.agentcontrol.app.ui.JarvisTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()
    // Sensor de proximidade: só liga durante a chamada, então não gasta bateria o resto do tempo.
    private val sensorManager by lazy { getSystemService(Context.SENSOR_SERVICE) as SensorManager }
    private val proximidade by lazy { sensorManager.getDefaultSensor(Sensor.TYPE_PROXIMITY) }
    private val ouvinteProximidade = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            val perto = e.values.isNotEmpty() && e.values[0] < (proximidade?.maximumRange ?: 5f)
            vm.callProximity(perto)
        }
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Android 13+: pede para mostrar os avisos de aprovação.
        if (Build.VERSION.SDK_INT >= 33) {
            registerForActivityResult(ActivityResultContracts.RequestPermission()) { }.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        vm.openScreenFromShortcut(intent?.getStringExtra("screen"))
        setContent {
            val ui by vm.ui.collectAsState()
            JarvisTheme(ui.themeMode, ui.fontScale) { JarvisApp(vm) }
        }
    }

    /** Atalho do ícone (segurar o ícone do app) com o app já aberto. */
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        vm.openScreenFromShortcut(intent.getStringExtra("screen"))
    }

    override fun onResume() {
        super.onResume()
        vm.foreground = true
        proximidade?.let { sensorManager.registerListener(ouvinteProximidade, it, SensorManager.SENSOR_DELAY_NORMAL) }
    }

    override fun onPause() {
        vm.foreground = false
        sensorManager.unregisterListener(ouvinteProximidade)
        vm.callProximity(false) // saiu da tela com o celular no rosto: solta o microfone
        super.onPause()
    }
}
