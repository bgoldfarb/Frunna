# iOS Release Checklist (Frunna)

## Build + Signing
- [ ] Set production `bundleIdentifier` in `app.json`.
- [ ] Confirm Apple Team + signing certificates in Xcode.
- [ ] Confirm Release configuration builds on physical device.

## Capabilities
- [ ] HealthKit enabled.
- [ ] Calendar access enabled.
- [ ] Remove unused capabilities before release.

## Info.plist / Privacy Copy
- [ ] `NSHealthShareUsageDescription` is user-friendly and specific.
- [ ] `NSCalendarsUsageDescription` is user-friendly and specific.
- [ ] `NSCalendarsWriteOnlyAccessUsageDescription` is user-friendly and specific.
- [ ] `NSCalendarsFullAccessUsageDescription` is user-friendly and specific.

## Runtime QA (Device)
- [ ] Health auth flow works from clean install.
- [ ] Calendar sync + remove events works end-to-end.
- [ ] Plan generation works on supported Apple Intelligence hardware.
- [ ] Saved plans persist across app restarts.
- [ ] Today check-in persists and updates Progress metrics.
- [ ] Calendar view renders and day detail modal works.

## Performance + Stability
- [ ] No obvious frame drops when switching tabs/pages.
- [ ] No memory spikes during plan generation.
- [ ] App remains responsive if model returns malformed output.

## TestFlight
- [ ] Archive Release build and upload to App Store Connect.
- [ ] Verify dSYMs uploaded (symbolicated crashes).
- [ ] Add release notes with supported devices/iOS version.

## App Store Metadata
- [ ] Screenshots updated to current UI.
- [ ] Privacy Nutrition Label reflects Health + Calendar usage.
- [ ] App description explains on-device AI + data handling clearly.

## Nice-to-Have Native Upgrades
- [ ] Add haptics package (`expo-haptics`) for richer feedback than vibration.
- [ ] Add Home Screen Widget for today's workout.
- [ ] Add App Intents / Siri shortcuts ("What's my workout today?").
- [ ] Consider Live Activities for active workout countdown state.
