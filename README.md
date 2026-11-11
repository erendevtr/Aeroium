# Aeroium

A lightweight desktop browser built on Electron, with tabs, a command palette,
quick notes, reader mode, video speed control, dark mode, built-in ad and
tracker blocking, and Chrome extension support.

Supported UI languages: Turkish, English, German, French, Spanish, Italian,
Portuguese, Russian, Arabic, Chinese, Japanese, Korean, Hindi, Dutch, Polish.
The language follows the system locale.

## Features

- Tabs, address bar with search fallback, back/forward/reload
- Command palette (Ctrl+K) to switch tabs or search
- Quick notes per page
- Reader mode, video speed control, page dark mode
- Ad and tracker blocking (@ghostery/adblocker-electron)
- Chrome extensions via Chrome Web Store (install, launch, remove)
- Four themes: Aeroium Dark, Aeroium Light, Nord, Rosé

## Running from source

Requirements: Node.js 20 or newer.

```bash
git clone https://github.com/YOUR_USER/aeroium.git
cd aeroium
npm install
npm start
```

## Building a Linux package

```bash
npx electron-builder --linux deb
```

(Packaging configuration is not yet included; see the roadmap.)

## Project layout

```
main.js            Main process: tabs, IPC, permissions, extensions
preload.js         Bridge for the UI (renderer/index.html)
site-preload.js    Bridge for the local start page only
i18n.js            Locale detection and string loading
locales/           Translation files (one JSON per language)
renderer/          UI, start page, styles
```

## Adding a language

1. Copy `locales/en.json` to `locales/<code>.json`.
2. Translate the values. Keep the keys and `{query}` placeholders unchanged.
3. Add the code to `SUPPORTED` in `i18n.js`.

## Known limitations

- Chrome extensions depend on Electron support. Some extensions that use
  Chrome-only APIs (for example `webNavigation` or `contextMenus`) will not
  work fully.
- Right-to-left layout (Arabic) is applied to text direction only; the toolbar
  layout is not fully mirrored yet.

## Security

Please report security issues privately rather than in a public issue. See
[SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
