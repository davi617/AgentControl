plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "dev.agentcontrol.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.agentcontrol.app"
        minSdk = 26
        targetSdk = 35
        // tools/publicar-app.ps1 passa uma versão sempre maior; build comum fica em 1.
        versionCode = (project.findProperty("jarvisVersionCode") as String?)?.toInt() ?: 1
        versionName = (project.findProperty("jarvisVersionName") as String?) ?: "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Sem chave de assinatura própria ainda: o release sai assinado com a chave de debug
            // para instalar no seu celular. Trocar antes de distribuir para outras pessoas.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:okhttp-sse:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
