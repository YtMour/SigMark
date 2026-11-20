import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.sigmark.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sigmark.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 7
        versionName = "0.7.0"
    }

    buildTypes {
        debug {
            val origin = providers.gradleProperty("SIGMARK_LAN_URL").orElse("").get()
            require(origin.isEmpty() || Regex("""http://[0-9.]+:[0-9]{1,5}""").matches(origin)) {
                "SIGMARK_LAN_URL must be an HTTP numeric IPv4 origin with a port"
            }
            buildConfigField("String", "LAN_ORIGIN", "\"$origin\"")
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "LAN_ORIGIN", "\"\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

kotlin { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.10.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
}
