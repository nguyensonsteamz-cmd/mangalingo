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

    // Release signing: ONLY when the keystore is supplied from outside (never committed): environment variables or -P properties
    //   LINGOLENS_KEYSTORE (path), LINGOLENS_KEYSTORE_PASSWORD, LINGOLENS_KEY_ALIAS, LINGOLENS_KEY_PASSWORD.
    // Without them the release build is UNSIGNED (see docs/MT_ENGINE_SIGNING_GUIDE.md).
    fun signingValue(name: String): String? = (project.findProperty(name) as String?) ?: System.getenv(name)
    val keystorePath = signingValue("LINGOLENS_KEYSTORE")
    val hasSigning = !keystorePath.isNullOrBlank() && file(keystorePath).exists() &&
        listOf("LINGOLENS_KEYSTORE_PASSWORD", "LINGOLENS_KEY_ALIAS", "LINGOLENS_KEY_PASSWORD").all { !signingValue(it).isNullOrBlank() }
    if (hasSigning) {
        signingConfigs {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = signingValue("LINGOLENS_KEYSTORE_PASSWORD")
                keyAlias = signingValue("LINGOLENS_KEY_ALIAS")
                keyPassword = signingValue("LINGOLENS_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (hasSigning) signingConfig = signingConfigs.getByName("release")
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
