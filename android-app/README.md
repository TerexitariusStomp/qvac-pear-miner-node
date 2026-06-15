# QVAC-Pear Miner Android Test App

This is a Capacitor-wrapped Android app for testing the QVAC-Pear Miner embed flow on mobile devices.

## Prerequisites

- Node.js 18+
- Android Studio (for building APK)
- Android SDK (installed via Android Studio)

## Build Instructions

### 1. Install dependencies

```bash
cd android-app
npm install
```

### 2. Add Android platform

```bash
npx cap add android
```

### 3. Sync web assets to Android

```bash
npx cap sync android
```

### 4. Build APK

```bash
npx cap build android
```

Or open in Android Studio for debugging:

```bash
npx cap open android
```

Then in Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**

The APK will be output to:
```
android/app/build/outputs/apk/debug/app-debug.apk
```

## What This App Tests

- **Opt-in flow**: User taps "Opt In & Start Earning" to simulate consent
- **Embed script loading**: Loads `inference-embed.js` with `data-app-id` and `data-evm-address`
- **Background inference simulation**: Stats update in real-time (uptime, tasks, network, earnings)
- **Pause/Resume**: User can pause contribution at any time
- **Mobile UI**: Responsive dark theme optimized for phone screens

## Architecture

The app is a thin Android WebView wrapper around the QVAC inference embed. No Docker or heavy runtime is shipped — the embed script handles everything.

## Troubleshooting

**Build fails with "SDK not found"**: Open Android Studio and install the SDK via **Tools → SDK Manager**.

**APK won't install**: Enable "Install from unknown sources" in Android Settings → Security.

**Embed script not loading**: The app uses `https://cdn.qvac-pear.io/inference-embed.js`. Ensure the device has internet access for the first load.
