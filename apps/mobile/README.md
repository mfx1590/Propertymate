# @propverify/mobile

The Expo (React Native) app — Plan §2.1, §10.2. Customer-facing: search,
listing detail, favourites, viewings, chat and notifications, plus the Expo
push registration the API has had waiting since Phase 2 step 4.

Creating and verifying listings stays on the web deliberately: the wizard needs
document upload and a map pin, which belong on a desktop. The account screen
says so rather than leaving a seller hunting for the button.

## Running it

Start the infrastructure and API first — the app is useless without them:

```bash
docker compose up -d --wait
```

```bash
npm run dev -w apps/api
```

Then, from the repo root:

```bash
npm run dev -w apps/mobile
```

Press `a` / `i` for a device or simulator, or `w` for the browser.

### API address

`src/lib/config.ts` resolves the API in this order:

1. `EXPO_PUBLIC_API_URL`, if set.
2. On a device, the LAN host Metro served the bundle from, port 4000 —
   `localhost` on a phone means the phone, not your machine, so this is what
   makes a real handset work with no configuration.
3. `expo.extra.apiBase` in `app.json`, then `http://localhost:4000`.

## Browser preview

`npm run web -w apps/mobile` runs the app through `react-native-web`. It is a
development convenience, not a shipping target, and two things behave
differently there:

- **Push is unavailable.** There is no native notifications module, so the
  alerts screen hides the enable-notifications control rather than offering a
  button that cannot work.
- **Tokens fall back to `localStorage`.** `expo-secure-store` has no web
  implementation. On a device, tokens live in the Keychain / Android Keystore.

The API's dev CORS default allows `http://localhost:8081` for this reason.
Native builds send no `Origin` header, so CORS never applies to a real device.

## Notes

- Types and enums come from `@propverify/shared`, so role keys, locales and
  notification categories cannot drift from the API.
- `metro.config.js` is monorepo-aware: it watches the workspace root and
  disables hierarchical lookup so React is never resolved twice.
- i18n is a small local translator (`src/i18n`) over the same dotted-key JSON
  shape the web uses — next-intl has no React Native runtime. Missing keys fall
  back through English rather than rendering the raw key.
- Native release builds go through EAS, not `turbo build`; the `build` script
  is deliberately a no-op so CI stays green.
