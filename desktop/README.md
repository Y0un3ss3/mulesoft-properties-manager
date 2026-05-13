# MuleSoft Properties Manager — Desktop App

Native desktop app built with Electron + React + Vite. Works offline on Windows, macOS, and Linux.

## Development

```bash
npm install
npm run dev
```

This starts Vite dev server and Electron concurrently with hot reload.

## Build

```bash
npm run build:win     # Windows portable .exe
npm run build:mac     # macOS .dmg (Apple Silicon)
npm run build:linux   # Linux AppImage
```

## Project Structure

```
├── electron/         # Electron main process
│   ├── main.js       # Window creation, IPC handlers
│   └── preload.js    # Context bridge (electronAPI)
├── src/              # React frontend
│   ├── components/   # React components
│   ├── lib/          # Crypto, parser, highlighter utilities
│   ├── App.jsx       # Root component
│   ├── main.jsx      # Entry point
│   └── styles.css    # Styles
├── public/           # Static assets (icons)
├── scripts/          # Build helper scripts (icon generation)
├── index.html        # Vite HTML entry
├── vite.config.js    # Vite configuration
└── package.json      # Dependencies and electron-builder config
```

## Features

- Native file/folder picker dialogs
- Dark/light theme with OS sync
- Custom title bar (Windows overlay, macOS traffic lights)
- All crypto operations run locally
