# Android — physical-device test checklist

Status: **NOT RUN on a physical device** (none available). The same flows ran in the Android 15 x86_64 emulator (`scripts/android-emulator-test.mjs`, 15/15). An emulator is not an ARM phone: CPU speed, memory pressure and WebView version can all differ.

## Prepare
1. `npm run build:mobile && cd android && ./gradlew assembleDebug`, then `adb install -r app/build/outputs/apk/debug/app-debug.apk` (debug builds allow WebView remote debugging, release builds do not).
2. USB debugging on; `adb devices` shows the phone. Optional: `node scripts/android-emulator-test.mjs` drives the same 15 checks on a physical device (it picks the app's DevTools socket through adb).
3. Note: model, Android version, RAM, ABI (`adb shell getprop ro.product.cpu.abi` should be `arm64-v8a`).

## Manual checks (tick and write the result)
| # | Check | Expected | Result |
|---|---|---|---|
| 1 | Settings → Hạn mức dịch → *Mô hình dịch tải về*: both rows show size + licence; nothing downloaded | no network use | |
| 2 | Download en→vi (Wi-Fi) | progress → "Đã tải"; ≈ 102 MB | |
| 3 | Download vi→en | same | |
| 4 | Translate an English paragraph, then a Vietnamese one (turn off ML Kit? use the "Ưu tiên" switch) | correct direction; provider name shown | |
| 5 | Long text (> 5,000 chars) with the model: progress, **Huỷ**, **Dịch tiếp** | resume sends only the rest | |
| 6 | UI stays smooth while translating (scroll, tap) | no freeze | |
| 7 | Home → other apps (open a heavy app) → return | still works; no crash | |
| 8 | Force-stop and reopen | model still "Đã tải", no re-download | |
| 9 | Airplane mode: translate with the downloaded model | works offline | |
| 10 | Airplane mode: start a download | friendly "ngoại tuyến" error | |
| 11 | Fill the storage (< 250 MB free) and start a download | refused with a storage message | |
| 12 | ML Kit en→vi and vi→en (default provider): first use downloads the Vietnamese pack | translations OK | |
| 13 | Peak memory: `adb shell dumpsys meminfo app.mangalingo` and the WebView renderer (`…sandboxed_process…`) while translating with both models | record PSS; the emulator showed ≈ 1.0 GB total | |
| 14 | Low-RAM phone (≤ 3 GB): does the app survive? | decide whether to hide the model below a RAM threshold (engineering target, not yet enforced) | |
| 15 | Release build (`assembleRelease`, signed) opens with **no** remote-debugging socket | `cat /proc/net/unix | grep devtools` empty | |
