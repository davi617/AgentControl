plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "dev.agentcontrol.app"
    compileSdk = 37

    defaultConfig {
        applicationId = "dev.agentcontrol.app"
        minSdk = 26
        targetSdk = 36
        // tools/publicar-app.ps1 passa uma versão sempre maior; build comum fica em 1.
        versionCode = (project.findProperty("jarvisVersionCode") as String?)?.toInt() ?: 1
        // Nome da versão: o mesmo version.json do servidor e do app do PC (fonte única, v4.0).
        val fromFile = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(rootProject.file("../version.json").readText())?.groupValues?.get(1)
        versionName = (project.findProperty("jarvisVersionName") as String?) ?: fromFile ?: "1.0.0"
    }

    // Assinatura: com ANDROID_KEYSTORE_FILE (e as senhas) no ambiente, o release sai assinado com a SUA chave, a que
    // já está nos celulares, e atualiza por cima. Sem isso, usa a chave de debug da máquina que compila.
    val releaseKeystore: String? = System.getenv("ANDROID_KEYSTORE_FILE")
    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (releaseKeystore != null) "release" else "debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.squareup.okhttp3:okhttp:5.5.0")
    implementation("com.squareup.okhttp3:okhttp-sse:5.5.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
}
