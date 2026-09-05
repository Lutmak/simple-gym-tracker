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

An offline workout tracker for Android. It has no account, no analytics, and no network
permission — the `INTERNET` permission is blocked in the manifest, so the app cannot make a
network request even if it wanted to. Everything lives in a SQLite database on the device.

## About this fork

This project is a fork of [basarsubasi/simplefitnessapp](https://github.com/basarsubasi/simplefitnessapp)
("**Simple.**"), taken at upstream `v1.7.15` after upstream had been dormant for eight months.
Full credit to **Başar Subaşı** for the original work, which remains MIT-licensed (see
[License](#license) below). The application id, name and UI have since diverged enough that this
is a separate app: it does not upgrade an existing install of the original, and the two can
coexist on one device.

## What it does

The app has four tabs — **Inicio** (today), **Progreso**, **Rutinas** and **Ajustes** — plus a
raised centre button, **Entrenar**, whose action depends on what is due: it starts today's
session, resumes one in progress, opens a missed session's resolution, opens a pending cycle
review, or offers a rest-day shortcut. There is no separate "log a workout" screen to find.

- **One active routine at a time.** Activating a routine deactivates the previous one; training
  history is never deleted or rewritten when a routine changes.
- **Three progression rules**, chosen per routine: **wave** (Jim Wendler's 5/3/1 — four weeks of
  percentages off a training max, with a deload week and an end-of-cycle review that proposes
  the next training max from what was actually lifted), **linear** (weight increases by a fixed
  increment once every set in a session is completed), and **none** (free logging against a plan
  with no automatic progression).
- **Weights are learned, not requested.** Activating any routine — including a 5/3/1 program —
  asks for zero numbers. A training max or starting weight is entered by hand only if you already
  know it; otherwise the app derives it from the first session you actually log.
- **22 preset routines**, from beginner full-body splits to intermediate barbell programs and two
  5/3/1 variants, offered behind "Nueva rutina" and never mixed into your own routine list.
- **Routine import and export.** A routine's plan — sessions, exercises, progression settings,
  training maxes if you choose to write them — is a portable `.sgtroutine.json` file: version 1
  of the `sgt-routine` format, plain JSON, human-writable. Export is a row in a routine's action
  sheet; import is the fourth option on "Nueva rutina" (the other three are from scratch, a 5/3/1
  setup wizard, and a preset). An imported routine is never activated automatically, and a
  colliding name is suffixed rather than asking. History is never exported or imported — only the
  plan. A minimal example:

  ```json
  {
    "format": "sgt-routine",
    "version": 1,
    "routine": {
      "name": "My Program",
      "progressionRule": "linear",
      "unit": "kg",
      "roundingIncrement": 2.5,
      "restMainSeconds": 120,
      "restAccessorySeconds": 60
    },
    "sessions": [
      {
        "weekday": 1,
        "name": "Full Body",
        "exercises": [
          {
            "catalogKey": "Barbell_Squat",
            "catalogName": "Barbell Squat",
            "role": "main",
            "targetSets": 3,
            "targetReps": 5,
            "loadSource": "absolute"
          }
        ]
      }
    ]
  }
  ```

  An exercise is referenced by the exercise catalog's stable `catalogKey` (`catalogName` is
  accepted too, as a hand-authoring convenience, resolved case-insensitively); an exercise the
  catalog does not have is declared inline as a `custom` block instead. See
  `data/fixtures/*.sgtroutine.json` for two complete, real routines — a 5/3/1 template and a
  linear push/pull/legs split — including training maxes, a custom exercise and bar profiles.

- **Demo data.** Ajustes can load a demo routine with several weeks of logged history, to see the
  app populated without training first, and remove it again on request.
- **Backup and restore.** Ajustes can export the whole on-device database to a file and restore
  from one later. This is an all-or-nothing copy of everything, distinct from a single routine's
  `.sgtroutine.json` export.

## Languages

English and Español. The two locale files (`locales/en/translation.json`,
`locales/es/translation.json`) are kept in identical key coverage by a parity test
(`locales/localeParity.test.ts`); a new user-facing string is added to both in the same commit.
The exercise catalog itself (names, muscles, equipment, instructions) stays in English in both
languages — it is reference data, not UI copy.

## Installation

This app has not been published to any app store. Google Play and F-Droid releases are planned;
until then, build it from source (below).

> Looking for the original app this was forked from? It is on
> [F-Droid](https://f-droid.org/packages/tr.com.basarsubasi.simplefitnessapp),
> [Google Play](https://play.google.com/store/apps/details?id=tr.com.basarsubasi.simplefitnessapp)
> and the [App Store](https://apps.apple.com/us/app/simple-fitness-simplified/id6740262965).

## Running in Expo Go

Requires Node.js and the **Expo Go** app on an Android phone. No Android SDK, JDK, Gradle or
emulator needed for day-to-day development.

Expo Go ships a single SDK runtime, so it must match this project's — currently **Expo SDK 57**.
If Expo Go reports a version mismatch, the Play Store has moved it ahead of the project, not the
other way round.

```bash
npm ci
npx expo start --go   # scan the QR code from Expo Go, phone on the same Wi-Fi
```

Edits hot-reload on the device. To check a change without a phone at all:

```bash
npx tsc --noEmit                    # typecheck — zero errors under strict
npm test                            # unit tests over utils/ — zero failures
npx expo-doctor                     # config/dependency sanity — 21/21
npx expo export --platform android  # bundle only; no device required
```

`android/` and `ios/` are generated by `npx expo prebuild` and are not in version control — all
native configuration lives in `app.json`. Never hand-edit the generated folders.

## Building with EAS

Release builds go through [EAS Build](https://docs.expo.dev/build/introduction/) in the cloud, so
a local native toolchain (JDK, Android SDK) is never required to produce an installable build.
`eas.json` defines two profiles:

- **`preview`** — an internal-distribution `.apk`, for installing directly on a test device.
- **`production`** — an `.aab` app bundle, for a Play Store submission.

```bash
eas build --profile preview --platform android      # .apk, for direct install
eas build --profile production --platform android   # .aab, for the Play Store
```

Building requires an EAS account and project of your own (`eas init`); this repository's own EAS
project association is not published.

## License

MIT — see [LICENSE](./LICENSE). Original copyright © 2024 Başar Subaşı; fork copyright © 2026
Lutmak. `LICENSE` carries both notices, upstream's first, as MIT requires.
