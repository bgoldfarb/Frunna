# Frunna

Frunna is an iOS-first Expo app that combines Apple Health data and on-device Apple Intelligence to generate adaptive running plans.

## What It Does
- Builds multi-week running plans using HealthKit trends.
- Uses Apple Intelligence (`FoundationModels`) for plan generation and plan Q&A.
- Supports plan views: `Overview`, `Today`, `Progress`, and `Calendar`.
- Saves plans and workout check-ins locally on device.
- Syncs workouts to iOS Calendar and supports removal.

## Tech Stack
- Expo SDK 54
- React Native 0.81
- Custom Expo native module (`modules/expo-apple-intelligence`)
- iOS frameworks:
  - `HealthKit`
  - `EventKit`
  - `FoundationModels` (Apple Intelligence)

## Requirements
- macOS + Xcode
- iPhone (recommended; Apple Intelligence requires supported hardware + OS)
- iOS development build (this does not run in Expo Go for native module features)

## Run Locally
From `expo-ai-phone`:

```bash
npm install
npm run ios -- --device
```

If Metro acts stale:

```bash
npx expo start --clear
```

## iOS Permissions
Configured in `app.json`:
- `NSHealthShareUsageDescription`
- `NSCalendarsUsageDescription`
- `NSCalendarsWriteOnlyAccessUsageDescription`
- `NSCalendarsFullAccessUsageDescription`

HealthKit entitlement is enabled under:
- `expo.ios.entitlements.com.apple.developer.healthkit`

## Core App Flow
1. Setup page:
- Select running level, goal distance, recent time, training days/week, and plan length.
- Optional advanced options (long-run day, unit, lookback days).

2. Build plan:
- Requests HealthKit authorization.
- Fetches trends and workout history.
- Generates weekly plan sections via Apple Intelligence.
- Applies run-day guardrails and pacing constraints.

3. Plan page:
- `Overview`: week tables + AI follow-up Q&A.
- `Today`: today’s workout + check-in form.
- `Progress`: adherence and check-in averages.
- `Calendar`: week calendar layout with day detail modal.

## Data Storage
Frunna stores saved plans and check-ins locally using iOS native storage via module methods:
- `setStoredValueAsync`
- `getStoredValueAsync`
- `removeStoredValueAsync`

Storage keys used in app:
- `frunna_saved_plans_v1`
- `frunna_completions_v1`

## Project Structure
- `App.tsx` - main UI and app orchestration
- `prompts/adaptiveRunningCoachPrompt.ts` - prompt templates + AI constraints
- `modules/expo-apple-intelligence/ios/ExpoAppleIntelligenceModule.swift` - iOS native APIs (AI, Health, Calendar, storage)
- `modules/expo-apple-intelligence/src/ExpoAppleIntelligenceModule.ts` - JS bridge
- `IOS_RELEASE_CHECKLIST.md` - iOS release checklist

## Notes
- Apple Intelligence calls can fail with context limits; app includes compact fallback generation.
- Plan generation is iOS-only for full functionality.
- For shipping, use the checklist in `IOS_RELEASE_CHECKLIST.md`.
