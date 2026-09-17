"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => FocusModePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var HIDE_CLASS = "focus-mode-hidden";
var SHOW_CLASS = "focus-mode-visible";
var EMBEDDED_POINTER_MESSAGE = "10x-focus-mode-pointer";
var TAP_MAX_MOVEMENT_PX = 12;
var TAP_MAX_DURATION_MS = 600;
var SUPPORTED_FILE_EXTENSIONS = ["md", "canvas", "html", "pdf", "base"];
var DEFAULT_SETTINGS = {
  showToggleNotices: false,
  fileExtensions: ["html"]
};
var FocusModePlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.enabled = false;
    this.activeLeaf = null;
    this.styleEl = null;
    this.activeContentEl = null;
    this.activeDocument = null;
    this.tapGesture = null;
    this.settings = DEFAULT_SETTINGS;
    this.handlePointerDown = (event) => {
      if (!event.isPrimary || event.button !== 0 || !this.isDocumentSurface(event.target)) {
        this.tapGesture = null;
        return;
      }
      const leaf = this.findLeafContaining(event.target);
      if (!leaf || !this.isLeafAllowed(leaf)) {
        this.tapGesture = null;
        return;
      }
      this.startTapGesture(event.pointerId, event.clientX, event.clientY, leaf);
    };
    this.handlePointerMove = (event) => {
      this.trackTapMovement(event.pointerId, event.clientX, event.clientY);
    };
    this.handlePointerUp = (event) => {
      if (!this.isDocumentSurface(event.target)) {
        this.tapGesture = null;
        return;
      }
      this.finishTapGesture(event.pointerId, event.clientX, event.clientY);
    };
    this.handlePointerCancel = () => {
      this.tapGesture = null;
    };
    this.handleEmbeddedPointerMessage = (event) => {
      const message = this.parseEmbeddedPointerMessage(event.data);
      if (!message) {
        return;
      }
      const frame = this.findFrameByWindow(event.source);
      if (!frame) {
        return;
      }
      const leaf = this.findLeafContaining(frame);
      if (!leaf || !this.isLeafAllowed(leaf)) {
        return;
      }
      if (message.phase === "down") {
        if (!message.isPrimary || message.button !== 0) {
          this.tapGesture = null;
          return;
        }
        this.startTapGesture(message.pointerId, message.x, message.y, leaf);
        return;
      }
      if (message.phase === "move") {
        this.trackTapMovement(message.pointerId, message.x, message.y);
        return;
      }
      if (message.phase === "up") {
        this.finishTapGesture(message.pointerId, message.x, message.y);
        return;
      }
      this.tapGesture = null;
    };
  }
  async onload() {
    await this.loadSettings();
    this.ensureStyles();
    this.addSettingTab(new FocusModeSettingTab(this.app, this));
    this.addCommand({
      id: "toggle-focus-mode",
      name: "Toggle focus mode",
      callback: () => {
        this.toggleFocusMode(true);
      }
    });
    this.registerDomEvent(document, "pointerdown", this.handlePointerDown, true);
    this.registerDomEvent(document, "pointermove", this.handlePointerMove, true);
    this.registerDomEvent(document, "pointerup", this.handlePointerUp, true);
    this.registerDomEvent(document, "pointercancel", this.handlePointerCancel, true);
    this.registerDomEvent(window, "message", this.handleEmbeddedPointerMessage);
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        if (!this.enabled) {
          return;
        }
        this.reapplyFocusMode();
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!this.enabled || !leaf) {
          return;
        }
        this.activeLeaf = leaf;
        this.reapplyFocusMode();
      })
    );
    this.app.workspace.onLayoutReady(() => {
      window.setTimeout(() => {
        const leaf = this.app.workspace.activeLeaf;
        if (leaf) {
          this.enabled = true;
          this.activeLeaf = leaf;
          this.reapplyFocusMode();
        }
      }, 0);
    });
  }
  onunload() {
    this.clearFocusMode();
    this.styleEl?.remove();
    this.styleEl = null;
  }
  toggleFocusMode(showNotice, targetLeaf) {
    const leaf = targetLeaf ?? this.app.workspace.activeLeaf;
    if (!leaf || !this.isLeafAllowed(leaf)) {
      if (showNotice) {
        new import_obsidian.Notice("Focus Mode: this file type is not enabled in settings.");
      }
      return;
    }
    if (this.enabled) {
      this.clearFocusMode();
      if (showNotice) {
        this.showToggleNotice("Focus Mode: restored the normal workspace.");
      }
      return;
    }
    if (!leaf?.view?.containerEl) {
      new import_obsidian.Notice("Focus Mode: there is no active pane to focus.");
      return;
    }
    this.enableFocusMode(leaf, showNotice);
  }
  enableFocusMode(leaf, showNotice) {
    if (!this.isLeafAllowed(leaf)) {
      return;
    }
    const applied = this.applyFocusMode(leaf);
    if (!applied) {
      new import_obsidian.Notice("Focus Mode: could not determine the active pane container.");
      return;
    }
    this.enabled = true;
    this.activeLeaf = leaf;
    this.hideNativeStatusBar();
    if (showNotice) {
      this.showToggleNotice("Focus Mode: now focusing the active pane.");
    }
  }
  startTapGesture(pointerId, x, y, leaf) {
    this.tapGesture = {
      pointerId,
      startX: x,
      startY: y,
      startedAt: Date.now(),
      moved: false,
      leaf
    };
  }
  trackTapMovement(pointerId, x, y) {
    const gesture = this.tapGesture;
    if (!gesture || gesture.pointerId !== pointerId) {
      return;
    }
    if (Math.hypot(x - gesture.startX, y - gesture.startY) > TAP_MAX_MOVEMENT_PX) {
      gesture.moved = true;
    }
  }
  finishTapGesture(pointerId, x, y) {
    const gesture = this.tapGesture;
    this.tapGesture = null;
    if (!gesture || gesture.pointerId !== pointerId) {
      return;
    }
    const moved = gesture.moved || Math.hypot(x - gesture.startX, y - gesture.startY) > TAP_MAX_MOVEMENT_PX;
    const heldTooLong = Date.now() - gesture.startedAt > TAP_MAX_DURATION_MS;
    if (moved || heldTooLong) {
      return;
    }
    window.setTimeout(() => {
      if (!gesture.leaf.view.containerEl.isConnected) {
        return;
      }
      this.app.workspace.setActiveLeaf(gesture.leaf, { focus: true });
      this.toggleFocusMode(false, gesture.leaf);
    }, 0);
  }
  isDocumentSurface(target) {
    return target instanceof Element && target.closest(".view-content") !== null;
  }
  findLeafContaining(target) {
    if (!(target instanceof Node)) {
      return null;
    }
    let match = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!match && leaf.view.containerEl.contains(target)) {
        match = leaf;
      }
    });
    return match;
  }
  findFrameByWindow(source) {
    if (!source) {
      return null;
    }
    for (const frame of document.querySelectorAll(".view-content iframe")) {
      if (frame instanceof HTMLIFrameElement && frame.contentWindow === source) {
        return frame;
      }
    }
    return null;
  }
  parseEmbeddedPointerMessage(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const message = value;
    const validPhase = message.phase === "down" || message.phase === "move" || message.phase === "up" || message.phase === "cancel";
    if (message.type !== EMBEDDED_POINTER_MESSAGE || !validPhase || typeof message.pointerId !== "number" || typeof message.x !== "number" || typeof message.y !== "number" || typeof message.button !== "number" || typeof message.isPrimary !== "boolean") {
      return null;
    }
    return message;
  }
  async loadSettings() {
    const savedSettings = await this.loadData();
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...savedSettings,
      fileExtensions: this.normalizeFileExtensions(
        savedSettings?.fileExtensions ?? DEFAULT_SETTINGS.fileExtensions
      )
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  getSettings() {
    return this.settings;
  }
  async updateSettings(settings) {
    this.settings = {
      ...this.settings,
      ...settings
    };
    await this.saveSettings();
    if (this.enabled) {
      this.reapplyFocusMode();
    }
  }
  normalizeFileExtensions(value) {
    const extensions = Array.isArray(value) ? value : String(value ?? "").split(",");
    return [...new Set(
      extensions.map((extension) => String(extension).trim().toLowerCase().replace(/^\./, "")).filter(Boolean)
    )];
  }
  getAvailableFileExtensions() {
    return [...SUPPORTED_FILE_EXTENSIONS];
  }
  isLeafAllowed(leaf) {
    const extension = leaf?.view?.file?.extension;
    return typeof extension === "string" && this.settings.fileExtensions.includes(extension.toLowerCase());
  }
  showToggleNotice(message) {
    if (this.settings.showToggleNotices) {
      new import_obsidian.Notice(message);
    }
  }
  reapplyFocusMode() {
    const leaf = this.getTargetLeaf();
    if (leaf?.view?.containerEl && !this.isLeafAllowed(leaf)) {
      this.clearMarkedElements();
      this.showNativeStatusBar();
      return;
    }
    if (!leaf?.view?.containerEl) {
      this.clearFocusMode();
      return;
    }
    this.clearMarkedElements();
    const applied = this.applyFocusMode(leaf);
    if (!applied) {
      this.clearFocusMode();
    } else {
      this.hideNativeStatusBar();
    }
  }
  getTargetLeaf() {
    if (this.activeLeaf?.view?.containerEl?.isConnected) {
      return this.activeLeaf;
    }
    return this.app.workspace.activeLeaf ?? null;
  }
  applyFocusMode(leaf) {
    if (!this.isLeafAllowed(leaf)) {
      return false;
    }
    const contentEl = this.getContentElement(leaf);
    if (!(contentEl instanceof HTMLElement)) {
      return false;
    }
    const ownerDocument = contentEl.ownerDocument;
    const body = ownerDocument.body;
    this.activeContentEl = contentEl;
    this.activeDocument = ownerDocument;
    contentEl.style.marginTop = "0px";
    let current = contentEl;
    let split = contentEl;
    while (split && !split.classList.contains("workspace-split")) {
      current.classList.add(SHOW_CLASS);
      current = split;
      split = split.parentElement;
    }
    if (current) {
      current.classList.add(SHOW_CLASS);
      current.querySelectorAll(`div.workspace-split:not(.${SHOW_CLASS})`).forEach((element) => {
        if (element instanceof HTMLElement && element !== current) {
          element.classList.add(SHOW_CLASS);
        }
      });
      current.querySelector(`div.workspace-leaf-content.${SHOW_CLASS} > .view-header`)?.classList.add(SHOW_CLASS);
      current.querySelectorAll(`div.workspace-tab-container.${SHOW_CLASS} > div.workspace-leaf:not(.${SHOW_CLASS})`).forEach((element) => {
        if (element instanceof HTMLElement) {
          element.classList.add(SHOW_CLASS);
        }
      });
      current.querySelectorAll(`div.workspace-tabs.${SHOW_CLASS} > div.workspace-tab-header-container`).forEach((element) => {
        if (element instanceof HTMLElement) {
          element.classList.add(SHOW_CLASS);
        }
      });
      current.querySelectorAll(`div.workspace-split.${SHOW_CLASS} > div.workspace-tabs:not(.${SHOW_CLASS})`).forEach((element) => {
        if (element instanceof HTMLElement) {
          element.classList.add(SHOW_CLASS);
        }
      });
    }
    body.querySelectorAll(`div.workspace-split:not(.${SHOW_CLASS})`).forEach((element) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      if (element !== split) {
        element.classList.add(HIDE_CLASS);
      } else {
        element.classList.add(SHOW_CLASS);
      }
    });
    body.querySelector(`div.workspace-leaf-content.${SHOW_CLASS} > .view-header`)?.classList.add(HIDE_CLASS);
    body.querySelectorAll(`div.workspace-tab-container.${SHOW_CLASS} > div.workspace-leaf:not(.${SHOW_CLASS})`).forEach((element) => {
      if (element instanceof HTMLElement) {
        element.classList.add(HIDE_CLASS);
      }
    });
    body.querySelectorAll(`div.workspace-tabs.${SHOW_CLASS} > div.workspace-tab-header-container`).forEach((element) => {
      if (element instanceof HTMLElement) {
        element.classList.add(HIDE_CLASS);
      }
    });
    body.querySelectorAll(`div.workspace-split.${SHOW_CLASS} > div.workspace-tabs:not(.${SHOW_CLASS})`).forEach((element) => {
      if (element instanceof HTMLElement) {
        element.classList.add(HIDE_CLASS);
      }
    });
    this.hideSelectors(body, ["div.workspace-ribbon", "div.mobile-navbar", "div.status-bar", "div.titlebar"]);
    const mobileRoot = body.querySelector(".is-mobile .workspace > .mod-root");
    if (mobileRoot instanceof HTMLElement) {
      mobileRoot.style.paddingTop = "0px";
    }
    return true;
  }
  hideSelectors(root, selectors) {
    for (const selector of selectors) {
      root.querySelectorAll(selector).forEach((element) => {
        if (element instanceof HTMLElement) {
          element.classList.add(HIDE_CLASS);
        }
      });
    }
  }
  clearFocusMode() {
    this.enabled = false;
    this.activeLeaf = null;
    this.clearMarkedElements();
    this.showNativeStatusBar();
  }
  getNativeStatusBar() {
    const capacitor = window.Capacitor;
    if (!capacitor || capacitor.getPlatform?.() === "web") {
      return null;
    }
    return capacitor.Plugins?.StatusBar ?? null;
  }
  hideNativeStatusBar() {
    const statusBar = this.getNativeStatusBar();
    if (!statusBar) {
      return;
    }
    void statusBar.hide().catch((error) => {
      console.warn("Focus Mode: could not hide the native status bar.", error);
    });
  }
  showNativeStatusBar() {
    const statusBar = this.getNativeStatusBar();
    if (!statusBar) {
      return;
    }
    void statusBar.show().catch((error) => {
      console.warn("Focus Mode: could not restore the native status bar.", error);
    });
  }
  clearMarkedElements() {
    const ownerDocument = this.activeDocument ?? document;
    const body = ownerDocument.body;
    body.querySelectorAll(`.${HIDE_CLASS}`).forEach((element) => {
      element.classList.remove(HIDE_CLASS);
    });
    body.querySelectorAll(`.${SHOW_CLASS}`).forEach((element) => {
      element.classList.remove(SHOW_CLASS);
    });
    const mobileRoot = body.querySelector(".is-mobile .workspace > .mod-root");
    if (mobileRoot instanceof HTMLElement) {
      mobileRoot.style.paddingTop = "";
    }
    if (this.activeContentEl) {
      this.activeContentEl.style.marginTop = "";
    }
    this.activeContentEl = null;
    this.activeDocument = null;
  }
  ensureStyles() {
    if (this.styleEl?.isConnected) {
      return;
    }
    const styleEl = document.createElement("style");
    styleEl.id = "focus-mode-plugin-styles";
    styleEl.textContent = `
      .${HIDE_CLASS} {
        display: none !important;
      }
    `;
    document.head.appendChild(styleEl);
    this.styleEl = styleEl;
  }
  getContentElement(leaf) {
    const view = leaf.view;
    if (view.contentEl instanceof HTMLElement) {
      return view.contentEl;
    }
    const fallback = view.containerEl.querySelector(".workspace-leaf-content");
    if (fallback instanceof HTMLElement) {
      return fallback;
    }
    return view.containerEl;
  }
};
var FocusModeSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, focusModePlugin) {
    super(app, focusModePlugin);
    this.focusModePlugin = focusModePlugin;
  }
  display() {
    this.containerEl.empty();
    new import_obsidian.Setting(this.containerEl).setName("File types").setDesc("Choose which file types use Focus Mode.").setHeading();
    for (const extension of this.focusModePlugin.getAvailableFileExtensions()) {
      new import_obsidian.Setting(this.containerEl).setName(`.${extension}`).addToggle((toggle) => {
        toggle.setValue(this.focusModePlugin.getSettings().fileExtensions.includes(extension)).onChange(async (enabled) => {
          const selected = new Set(this.focusModePlugin.getSettings().fileExtensions);
          if (enabled) {
            selected.add(extension);
          } else {
            selected.delete(extension);
          }
          await this.focusModePlugin.updateSettings({
            fileExtensions: [...selected].sort()
          });
        });
      });
    }
    new import_obsidian.Setting(this.containerEl).setName("Show toggle notifications").setDesc("Show a notice when focus mode is enabled or disabled with the command.").addToggle((toggle) => {
      toggle.setValue(this.focusModePlugin.getSettings().showToggleNotices).onChange(async (value) => {
        await this.focusModePlugin.updateSettings({ showToggleNotices: value });
      });
    });
  }
};
