# MuleSoft Properties Manager — Web App

A static web app that encrypts and decrypts values the same way the MuleSoft `secure-properties-tool.jar` does, plus a cross-environment Properties Inspector for comparing configs.

## Run it

Just open `index.html` in any modern browser. No build step, no server.

Or serve it with any static server:

```bash
npx serve .
```

## Features

- **Encrypt/Decrypt** — AES, Blowfish, DES, Triple DES (DESede) with CBC, CFB, ECB, OFB modes
- **File Processing** — Process entire `.properties` or `.yaml` files at once
- **Properties Inspector** — Compare property files across environments side by side

## How it works

- Key bytes come from the raw UTF-8 key string
- PKCS5/PKCS7 padding
- IV defaults to key bytes (truncated/zero-padded to block size), or random IV prepended to ciphertext
- Output is Base64 encoded

Everything runs client-side. Keys and values never leave your browser.

## Files

- `index.html` — markup and layout
- `styles.css` — GitHub Primer-inspired styling
- `app.js` — encryption/decryption logic and UI (uses CryptoJS)
- `crypto-js.min.js` — CryptoJS 4.2.0 (MIT license)
- `favicon.svg` — app icon
