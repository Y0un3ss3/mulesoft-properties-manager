# MuleSoft Properties Manager

A modern, open-source tool for encrypting, decrypting, and comparing MuleSoft secure property files — without the JAR hassle.

Available as a **web app**, a **desktop app** (Windows, macOS, Linux), and a lightweight **CLI-free workflow**. Everything runs locally — your keys and values never leave your machine.

## Features

- **Encrypt & Decrypt** — AES, Blowfish, DES, DESede with CBC/CFB/ECB/OFB modes. Matches the exact output of `secure-properties-tool.jar`.
- **File Processing** — Process entire `.properties` or `.yaml` files at once.
- **Properties Inspector** — Compare property files across environments side by side. Spot missing keys, differing values, and drift instantly.
- **100% Local** — All cryptographic operations happen in your browser or on your machine. Nothing is ever sent to a server.

## Project Structure

```
├── web/          # Static web app (vanilla JS, no build step required)
├── desktop/      # Native desktop app (Electron + React + Vite)
├── docs/         # Documentation & landing page
└── .github/      # CI/CD workflows
```

## Web App

The web app runs in any modern browser with zero dependencies or build steps.

```bash
cd web
# Just open index.html, or serve with any static server:
npx serve .
```

**Live:** [mpm.tools.unes.me](https://mpm.tools.unes.me)

## Desktop App

Native app for Windows, macOS, and Linux built with Electron.

```bash
cd desktop
npm install
npm run dev       # Development mode with hot reload
npm run build     # Build for current platform
```

## Documentation

The docs site is a static landing page deployed alongside the web app.

**Live:** [mpm.tools.unes.me/docs](https://mpm.tools.unes.me/docs)

## Development

### Prerequisites

- Node.js 20+
- npm 9+

### Web App

No build step needed for development. Just open `web/index.html` in a browser.

### Desktop App

```bash
cd desktop
npm install
npm run dev
```

### Docs

```bash
cd docs
# Open index.html or serve with any static server
npx serve .
```

## Deployment

### Web App & Docs

Deployed automatically to GitHub Pages on push to `main`:
- Web app: `mpm.tools.unes.me`
- Docs: `mpm.tools.unes.me/docs`

### Desktop App

Built and released automatically when a version tag is pushed:

```bash
git tag v1.2.3
git push origin v1.2.3
```

Artifacts are named: `mpm-<version>-<platform>.<extension>`
- `mpm-1.2.3-windows.exe`
- `mpm-1.2.3-macos.dmg`
- `mpm-1.2.3-linux.AppImage`

## Supported Algorithms

| Algorithm | Key Sizes | Block Size |
|-----------|-----------|------------|
| AES | 16, 24, or 32 bytes | 16 bytes |
| Blowfish | 4 to 56 bytes | 8 bytes |
| DES | 8 bytes | 8 bytes |
| DESede | 16 or 24 bytes | 8 bytes |

## License

MIT

## Author

[Younesse EL MANSOURI](https://www.linkedin.com/in/ynesel/)

Not affiliated with MuleSoft or Salesforce.
