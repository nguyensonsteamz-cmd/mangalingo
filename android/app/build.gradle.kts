plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Smart Setup (Google sign-in): the OAuth client id is a PUBLIC identifier (Android-type client, no secret), supplied at
// build time: -PLINGOLENS_OAUTH_ANDROID_CLIENT_ID=... or the environment variable of the same name. Empty = not configured.
val googleClientId: String = (project.findProperty("LINGOLENS_OAUTH_ANDROID_CLIENT_ID") as String?) ?: System.getenv("LINGOLENS_OAUTH_ANDROID_CLIENT_ID") ?: ""
val googleSuffix = ".apps.googleusercontent.com"
val googleRedirectScheme = if (googleClientId.endsWith(googleSuffix)) "com.googleusercontent.apps." + googleClientId.removeSuffix(googleSuffix) else "lingolens.oauth.unconfigured"

android {
    namespace = "app.mangalingo"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.mangalingo"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "GOOGLE_CLIENT_ID", "\"$googleClientId\"")
        manifestPlaceholders["googleRedirectScheme"] = googleRedirectScheme
    }
    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    // dictionary shards are already compact JSON – do not try to recompress them
    androidResources {
        noCompress += listOf("json")
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.webkit:webkit:1.12.1")
    // on-device English → Vietnamese translation (the model is downloaded once, then it works offline)
    implementation("com.google.mlkit:translate:17.0.3")
    testImplementation("junit:junit:4.13.2")
}
