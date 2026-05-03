# DisCryptoBank — Android (Capacitor) Build & Publish Guide

The Android app is a Capacitor wrapper around the existing **web** React/Vite app located in [discord-crypto-task-payroll-bot/web](discord-crypto-task-payroll-bot/web). It ships the same compiled React UI inside a native Android shell, so **all features, API calls, OAuth flows, owner-gated controls, and security rules behave identically to the web build** — there is no second codebase to maintain.

| Field                | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| App name             | **DisCryptoBank**                                      |
| Application ID       | `com.discryptobank.app`                                |
| Capacitor config     | [web/capacitor.config.ts](discord-crypto-task-payroll-bot/web/capacitor.config.ts) |
| Native project root  | [web/android](discord-crypto-task-payroll-bot/web/android) |
| Backend API          | `https://dcb-payroll-backend-production.up.railway.app` (auto-detected by [web/src/api.ts](discord-crypto-task-payroll-bot/web/src/api.ts) when running inside Capacitor) |

---

## How the API base URL is selected

[web/src/api.ts](discord-crypto-task-payroll-bot/web/src/api.ts) already detects the Capacitor runtime (`protocol === 'capacitor:' || 'file:' || serving from `https://localhost`) and switches `axios.baseURL` to the production backend automatically. **No mobile-specific code changes are needed** — the same login, JWT cookie/Bearer tokens, owner gate, treasury endpoints, audit PDF download, etc. all work.

## Auth on Android

- The Discord OAuth callback (in `apps/backend/src/api.js`) appends `?dcb_token=<jwt>` to the redirect URL when `uiBase` is set.
- The web app reads that token from the URL on load and stores it in `localStorage` under `dcb_token`. The `axios` request interceptor adds it as `Authorization: Bearer <token>` on every API call.
- This already works in Capacitor because `localStorage` and the `Authorization` header path are identical to the web flow — cookies are not required.

> **Action item before publishing**: in your backend env, set `OAUTH_REDIRECT_UI_BASE` (or the equivalent var) to a URL the Capacitor WebView can intercept. The simplest option is to keep redirecting to your current web frontend (e.g. `https://dcb-games.com`) — the page reads `dcb_token` from the query string and writes it to `localStorage`. Because the Capacitor WebView shares storage scope with itself, the token persists across launches.
>
> If you want a deep-linked return (no external browser bounce), add an `intent-filter` to `MainActivity` for the custom scheme `com.discryptobank.app://oauth-callback` and handle it via `App.addListener('appUrlOpen', ...)` in [web/src/App.tsx](discord-crypto-task-payroll-bot/web/src/App.tsx).

---

## Prerequisites

1. **Node 18+**, **npm**, **Java 17 (Temurin)**, **Android Studio Hedgehog** or newer (for the Android SDK + emulator).
2. Set `ANDROID_HOME` (e.g. `C:\Users\demar\AppData\Local\Android\Sdk`) and add `%ANDROID_HOME%\platform-tools` to PATH.
3. Install Capacitor CLI globally is optional — the local `npx` works.

```powershell
cd discord-crypto-task-payroll-bot/web
npm install
```

---

## Build a debug APK (sideload / test)

```powershell
cd discord-crypto-task-payroll-bot/web

# 1. Build the React/Vite bundle
npm run build

# 2. Sync the dist/ output into the Capacitor android project
npx cap sync android

# 3. Build a debug APK using Gradle
cd android
.\gradlew.bat assembleDebug

# Output APK:
# discord-crypto-task-payroll-bot/web/android/app/build/outputs/apk/debug/app-debug.apk
```

Install on a connected device:

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

Or open in Android Studio:

```powershell
cd discord-crypto-task-payroll-bot/web
npx cap open android
```

---

## Build a release AAB (Play Store upload)

### 1. Generate an upload keystore (one-time)

```powershell
cd discord-crypto-task-payroll-bot/web/android/app
keytool -genkeypair -v `
  -keystore discryptobank-release.keystore `
  -alias discryptobank `
  -keyalg RSA -keysize 2048 -validity 10000
```

> Keep `discryptobank-release.keystore` **out of git** — add it to `.gitignore` and back it up to a password manager. Losing it locks you out of Play Store updates.

### 2. Wire signing into Gradle

Append to [web/android/app/build.gradle](discord-crypto-task-payroll-bot/web/android/app/build.gradle) inside `android { ... }`:

```gradle
signingConfigs {
    release {
        storeFile file("discryptobank-release.keystore")
        storePassword System.getenv("DCB_KEYSTORE_PASSWORD") ?: project.findProperty("DCB_KEYSTORE_PASSWORD")
        keyAlias "discryptobank"
        keyPassword System.getenv("DCB_KEY_PASSWORD") ?: project.findProperty("DCB_KEY_PASSWORD")
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
        minifyEnabled true
        shrinkResources true
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
    }
}
```

Provide the passwords via environment variables (PowerShell):

```powershell
$env:DCB_KEYSTORE_PASSWORD="<store-password>"
$env:DCB_KEY_PASSWORD="<key-password>"
```

### 3. Build the AAB

```powershell
cd discord-crypto-task-payroll-bot/web
npm run build
npx cap sync android
cd android
.\gradlew.bat bundleRelease
```

Output: `web/android/app/build/outputs/bundle/release/app-release.aab` — this is what you upload to the Play Console.

---

## Bumping the app version

Each Play Store upload requires a higher `versionCode`. Edit [web/android/app/build.gradle](discord-crypto-task-payroll-bot/web/android/app/build.gradle):

```gradle
versionCode 2          // bump this integer every release
versionName "1.0.1"    // human readable
```

---

## Submitting to the Play Store (first time)

1. Sign up at <https://play.google.com/console> (one-time $25 fee).
2. Create app → **App name: DisCryptoBank** → Default language → Free/Paid → declare it's an app (not a game).
3. Complete the **App content** checklist:
   - Privacy policy URL (must be hosted somewhere reachable; can be on your existing site).
   - Data safety form — declare you collect Discord OAuth identifiers, account balances, and store auth tokens locally; no data is sold; transmitted in transit over HTTPS.
   - Target audience.
   - Ads / In-app purchases — both **No** unless that changes.
4. **Production → Create new release** → upload the `.aab` from step 3 above.
5. Add **graphic assets** (Play Console requires):
   - 512×512 high-res icon (PNG)
   - 1024×500 feature graphic (PNG/JPEG)
   - At least 2 phone screenshots (1080×1920 or similar)
6. **Content rating** questionnaire.
7. Submit for review (takes a few days for first-time publishers).

> **Internal testing track first**: before going to production, use the Play Console's *Internal testing* track to invite up to 100 testers via email. They install via a Play link without going through review.

---

## Updating the app

Whenever you ship a web change you want on Android:

```powershell
cd discord-crypto-task-payroll-bot/web
# bump versionCode in android/app/build.gradle first
npm run build
npx cap sync android
cd android
.\gradlew.bat bundleRelease
```

Upload the new `.aab` to the same release track in Play Console.

---

## What's already configured

- Application ID renamed `com.dcb.eventmanager → com.discryptobank.app` (java package directory moved, manifest `namespace`, `applicationId`, `MainActivity.java`, `strings.xml`).
- App display name set to **DisCryptoBank** in `strings.xml`.
- Capacitor plugins already wired: `@capacitor/app`, `@capacitor/haptics`, `@capacitor/keyboard`, `@capacitor/splash-screen`, `@capacitor/status-bar`.
- Splash + status bar themed `#060a13` to match the dark UI.
- `webContentsDebuggingEnabled: true` for development; **flip to false** in `capacitor.config.ts` before shipping the release AAB.
- API client auto-routes to production backend when running inside Capacitor.
- Owner gates, JWT auth, treasury controls, audit PDF download, Direct Deposit Form download — all work identically because they are pure HTTP to the same backend.

---

## TODO before first Play Store submission

- [ ] Replace the launcher icon — currently the default Capacitor icon. Generate adaptive icons via Android Studio (right-click `app/src/main/res` → New → Image Asset → Launcher Icons). Source PNG should be ≥ 1024×1024.
- [ ] Replace the splash image (`web/android/app/src/main/res/drawable*/splash.*`).
- [ ] Set `webContentsDebuggingEnabled: false` in `capacitor.config.ts` for release builds.
- [ ] Add a privacy policy URL accessible from inside the app (Settings → Privacy Policy link).
- [ ] Set up the upload keystore and CI secrets.
- [ ] Take 1080×1920 phone screenshots of the running app.
- [ ] (Optional) Configure deep-link `intent-filter` for `com.discryptobank.app://` if you want the Discord OAuth bounce to return without leaving the WebView.
