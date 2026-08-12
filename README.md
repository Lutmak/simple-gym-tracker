<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-black?style=for-the-badge)](./LICENSE)
[![Report a Bug](https://img.shields.io/badge/Issues-Report_a_Bug-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Lutmak/simple-gym-tracker/issues)

<!--
  TODO(donations): decide on a platform, then uncomment and fill in one of these.
  Ko-fi:            [![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-FF5E5B?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/USERNAME)
  Liberapay:        [![Liberapay](https://img.shields.io/badge/Liberapay-Donate-F6C915?style=for-the-badge&logo=liberapay&logoColor=black)](https://liberapay.com/USERNAME)
  GitHub Sponsors:  [![Sponsor](https://img.shields.io/badge/Sponsor-EA4AAA?style=for-the-badge&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/USERNAME)
-->

</div>

# **Simple: Gym Tracker**

An easy to use fitness app that lets you create, schedule and track your workouts — entirely on your device, with no account and no network access.

## 🍴 **About this fork**

This project is a fork of [basarsubasi/simplefitnessapp](https://github.com/basarsubasi/simplefitnessapp) ("**Simple.**"), forked at upstream `v1.7.15`.

The original is an excellent app — the UI, the name and above all the *simplicity* are why this fork exists rather than a rewrite. But upstream has seen no commits since December 2025, with open bug reports and feature requests going unanswered, so this fork picks the project back up: clearing the backlog the original maintainer left behind, and then extending it.

Full credit and thanks to **Başar Subaşı** for the original work, which remains MIT-licensed. This fork is published under a different name and a different application ID, so it is a **separate app** — it will not upgrade or replace an existing install of the original, and the two can be installed side by side.

## 🎯 **What this fork adds**

- **Fixes first.** The inherited bug backlog is the first priority.
- **First-class 5/3/1 support.** Native support for Jim Wendler's 5/3/1 programming: training-max driven percentages, warm-up ramps, and cycle progression, instead of hand-entering every set each week.
- **Same feel.** No redesign, no account, no telemetry, no network permission.

## 📸 **Screenshots**

> Screenshots below are inherited from upstream and predate this fork's rebrand — they will be re-captured before the first release.

<div align="center">
  <img
    src="https://github.com/user-attachments/assets/36020f7e-3cbc-4838-b726-0302b90d3ef2"
    width="200"
  />
  <img
    src="https://github.com/user-attachments/assets/dff21cb5-cd1e-414a-b17d-ca82fe5b5ee9"
    width="200"
  />
   <img
    src="https://github.com/user-attachments/assets/0542720a-65ea-40c2-be0e-68dd21de56cf"
    width="200"
  />
  <img
    src="https://github.com/user-attachments/assets/35319582-c612-486f-9149-d059db44bf36"
    width="200"
  />
  <img
    src="https://github.com/user-attachments/assets/00588301-720a-40d0-8d00-10e816b60cd3"
    width="200"
  />
  <img
    src="https://github.com/user-attachments/assets/addc611a-f830-446e-b9d4-c224b2bb7327"
    width="200"
  />
</div>

## 🚀 **Features**

🏋️ **Create a Workout**
- Choose a featured workout or easily create customized workouts with exercises, sets, and reps of your own

✏️ **Edit Your Workouts**
- Modify your existing workouts to update exercises, sets, or reps as your fitness goals evolve.

📅 **Schedule Your Workouts**
- Plan your fitness journey by scheduling workouts on specific days.

📊 **Track Your Progress**
- Log your weights and reps to monitor your progress over time with graphical data.

📆 **Customizable Date and Weight Formats**
- Choose between `dd-mm-yyyy` or `mm-dd-yyyy` date formats and toggle between `kg` or `lbs` for weights.

## 🌍 **Languages**

🇨🇿 🇩🇪 🇩🇰 🇬🇷 🇬🇧 🇪🇸 🇫🇮 🇫🇷 🇮🇹 🇯🇵 🇰🇷 🇳🇱 🇳🇴 🇵🇱 🇵🇹 🇷🇴 🇷🇺 🇸🇮 🇸🇪 🇹🇷 🇺🇦 🇨🇳

Translations are inherited from upstream. To add a language or improve an existing one, open a pull request against `locales/` — English (`locales/en/translation.json`) is the fallback, so any key missing from your language falls back to English rather than breaking.

## 🛠️ **How It Works**

1. **Adjust Settings**: Change the Date and Weight Formats to your liking.
2. **Create Workouts**: Start by adding days, exercises, sets, and reps.
3. **Schedule Workouts**: Plan your fitness routine by selecting a date.
4. **Track Progress**: Log weights and reps you have done during your workouts to see your improvement.

## ⬇️ **Installation**

This fork has not been published to any app store yet. Google Play and F-Droid releases are planned — until then, build from source (see below).

> Looking for the original app? It is still available on [F-Droid](https://f-droid.org/packages/tr.com.basarsubasi.simplefitnessapp), [Google Play](https://play.google.com/store/apps/details?id=tr.com.basarsubasi.simplefitnessapp) and the [App Store](https://apps.apple.com/us/app/simple-fitness-simplified/id6740262965).

## 🧑‍💻 **Building from source**

Requires only Node.js (20.19.4 is the minimum for Expo SDK 54; 26 is verified working) and the
**Expo Go** app on an Android phone. No Android SDK, JDK, Gradle or emulator needed for
day-to-day development.

Expo Go ships a single SDK runtime, so it must match this project's — currently **SDK 54**. If
Expo Go reports a version mismatch, the Play Store has moved it ahead of the project.

```bash
npm install
npx expo start --go   # scan the QR code from Expo Go, phone on the same Wi-Fi
```

Edits hot-reload on the device. To check a change without a phone at all:

```bash
npx tsc --noEmit                    # typecheck — should pass with zero errors
npx expo-doctor                     # config/dependency sanity — should pass 18/18
npx expo export --platform android  # bundle only; no SDK or device required
```

`android/` and `ios/` are generated by `npx expo prebuild` and are not in version control — all
native configuration lives in `app.json`. Never hand-edit them.

A full native build (`npm run android`) additionally needs JDK 17 and the Android SDK, but
release builds go through EAS Build in the cloud, so a local native toolchain is optional.

## ⚖️ **License**

MIT — see [LICENSE](./LICENSE). Original copyright © 2024 Başar Subaşı; fork copyright © 2026 Lutmak.
