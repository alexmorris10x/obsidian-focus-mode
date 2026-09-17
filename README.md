# Focus Mode

Focus Mode is a tiny Obsidian plugin that brings an Excalidraw-style distraction-free view to any active pane.

It is designed for the exact workflow where you want to focus on a markdown note, canvas, PDF, or other pane without needing to enter Excalidraw first.

## Features

- Global `Toggle focus mode` command
- Focus mode turns on automatically when the vault opens
- Tap the document to reveal or hide the surrounding Obsidian interface
- Scrolling and long presses do not toggle the interface
- Works from any active pane, not only Excalidraw
- Lets you choose enabled file types with checkboxes in the plugin settings
- Hides sidebars, ribbons, tab headers, status bar, and other panes
- On mobile, asks Obsidian's native bridge to hide the phone status bar while focused
- Cleans up automatically if the plugin is disabled or reloaded

## Local development

```bash
cd /Users/10x/dev/oss/obsidian-focus-mode
npm install
npm run build
```

For watch mode:

```bash
npm run dev
```

## Install in a local vault

Build the plugin, then copy these files into:

```text
<your-vault>/.obsidian/plugins/focus-mode/
  main.js
  manifest.json
  versions.json
```

Then enable `Focus Mode` in `Settings -> Community plugins`.

## Usage

Focus mode starts automatically for the file types selected in `Settings -> Focus Mode`. The supported choices are `.md`, `.canvas`, `.html`, `.pdf`, and `.base`. Tap inside an enabled document to reveal or hide the surrounding Obsidian interface. You can also run the command:

- `Focus Mode: Toggle focus mode`

Assign a hotkey in Obsidian if you want instant fullscreen-style focus from anywhere.

## Notes

- Focus mode is visual only. It does not move or change your notes.
- Toggling the command again restores the normal workspace layout.
