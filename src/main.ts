import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  WorkspaceLeaf,
} from "obsidian";

const HIDE_CLASS = "focus-mode-hidden";
const SHOW_CLASS = "focus-mode-visible";
const EMBEDDED_POINTER_MESSAGE = "10x-focus-mode-pointer";
const TAP_MAX_MOVEMENT_PX = 12;
const TAP_MAX_DURATION_MS = 600;
const SUPPORTED_FILE_EXTENSIONS = ["md", "canvas", "html", "pdf", "base"] as const;

interface FocusModeSettings {
  showToggleNotices: boolean;
  fileExtensions: string[];
}

interface TapGesture {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  moved: boolean;
  leaf: WorkspaceLeaf;
}

interface EmbeddedPointerMessage {
  type: typeof EMBEDDED_POINTER_MESSAGE;
  phase: "down" | "move" | "up" | "cancel";
  pointerId: number;
  x: number;
  y: number;
  button: number;
  isPrimary: boolean;
}

interface NativeStatusBarPlugin {
  hide(): Promise<void>;
  show(options?: { animation?: string }): Promise<void>;
}

interface CapacitorBridge {
  getPlatform?(): string;
  Plugins?: {
    StatusBar?: NativeStatusBarPlugin;
  };
}

const DEFAULT_SETTINGS: FocusModeSettings = {
  showToggleNotices: false,
  fileExtensions: ["html"],
};

export default class FocusModePlugin extends Plugin {
  private enabled = false;
  private activeLeaf: WorkspaceLeaf | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private activeContentEl: HTMLElement | null = null;
  private activeDocument: Document | null = null;
  private tapGesture: TapGesture | null = null;
  private settings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.ensureStyles();
    this.addSettingTab(new FocusModeSettingTab(this.app, this));

    this.addCommand({
      id: "toggle-focus-mode",
      name: "Toggle focus mode",
      callback: () => {
        this.toggleFocusMode(true);
      },
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
      }),
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!this.enabled || !leaf) {
          return;
        }

        this.activeLeaf = leaf;
        this.reapplyFocusMode();
      }),
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

  onunload(): void {
    this.clearFocusMode();
    this.styleEl?.remove();
    this.styleEl = null;
  }

  private toggleFocusMode(showNotice: boolean, targetLeaf?: WorkspaceLeaf): void {
    const leaf = targetLeaf ?? this.app.workspace.activeLeaf;

    if (!leaf || !this.isLeafAllowed(leaf)) {
      if (showNotice) {
        new Notice("Focus Mode: this file type is not enabled in settings.");
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
      new Notice("Focus Mode: there is no active pane to focus.");
      return;
    }

    this.enableFocusMode(leaf, showNotice);
  }

  private enableFocusMode(leaf: WorkspaceLeaf, showNotice: boolean): void {
    if (!this.isLeafAllowed(leaf)) {
      return;
    }

    const applied = this.applyFocusMode(leaf);

    if (!applied) {
      new Notice("Focus Mode: could not determine the active pane container.");
      return;
    }

    this.enabled = true;
    this.activeLeaf = leaf;
    this.hideNativeStatusBar();
    if (showNotice) {
      this.showToggleNotice("Focus Mode: now focusing the active pane.");
    }
  }

  private handlePointerDown = (event: PointerEvent): void => {
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

  private handlePointerMove = (event: PointerEvent): void => {
    this.trackTapMovement(event.pointerId, event.clientX, event.clientY);
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.isDocumentSurface(event.target)) {
      this.tapGesture = null;
      return;
    }

    this.finishTapGesture(event.pointerId, event.clientX, event.clientY);
  };

  private handlePointerCancel = (): void => {
    this.tapGesture = null;
  };

  private handleEmbeddedPointerMessage = (event: MessageEvent): void => {
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

  private startTapGesture(pointerId: number, x: number, y: number, leaf: WorkspaceLeaf): void {
    this.tapGesture = {
      pointerId,
      startX: x,
      startY: y,
      startedAt: Date.now(),
      moved: false,
      leaf,
    };
  }

  private trackTapMovement(pointerId: number, x: number, y: number): void {
    const gesture = this.tapGesture;
    if (!gesture || gesture.pointerId !== pointerId) {
      return;
    }

    if (Math.hypot(x - gesture.startX, y - gesture.startY) > TAP_MAX_MOVEMENT_PX) {
      gesture.moved = true;
    }
  }

  private finishTapGesture(pointerId: number, x: number, y: number): void {
    const gesture = this.tapGesture;
    this.tapGesture = null;

    if (!gesture || gesture.pointerId !== pointerId) {
      return;
    }

    const moved = gesture.moved
      || Math.hypot(x - gesture.startX, y - gesture.startY) > TAP_MAX_MOVEMENT_PX;
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

  private isDocumentSurface(target: EventTarget | null): target is Element {
    return target instanceof Element && target.closest(".view-content") !== null;
  }

  private findLeafContaining(target: EventTarget | null): WorkspaceLeaf | null {
    if (!(target instanceof Node)) {
      return null;
    }

    let match: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!match && leaf.view.containerEl.contains(target)) {
        match = leaf;
      }
    });
    return match;
  }

  private findFrameByWindow(source: MessageEventSource | null): HTMLIFrameElement | null {
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

  private parseEmbeddedPointerMessage(value: unknown): EmbeddedPointerMessage | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const message = value as Partial<EmbeddedPointerMessage>;
    const validPhase = message.phase === "down"
      || message.phase === "move"
      || message.phase === "up"
      || message.phase === "cancel";

    if (
      message.type !== EMBEDDED_POINTER_MESSAGE
      || !validPhase
      || typeof message.pointerId !== "number"
      || typeof message.x !== "number"
      || typeof message.y !== "number"
      || typeof message.button !== "number"
      || typeof message.isPrimary !== "boolean"
    ) {
      return null;
    }

    return message as EmbeddedPointerMessage;
  }

  private async loadSettings(): Promise<void> {
    const savedSettings = await this.loadData() as Partial<FocusModeSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...savedSettings,
      fileExtensions: this.normalizeFileExtensions(
        savedSettings?.fileExtensions ?? DEFAULT_SETTINGS.fileExtensions,
      ),
    };
  }

  private async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  getSettings(): FocusModeSettings {
    return this.settings;
  }

  async updateSettings(settings: Partial<FocusModeSettings>): Promise<void> {
    this.settings = {
      ...this.settings,
      ...settings,
    };
    await this.saveSettings();

    if (this.enabled) {
      this.reapplyFocusMode();
    }
  }

  normalizeFileExtensions(value: unknown): string[] {
    const extensions = Array.isArray(value) ? value : String(value ?? "").split(",");
    return [...new Set(
      extensions
        .map((extension) => String(extension).trim().toLowerCase().replace(/^\./, ""))
        .filter(Boolean),
    )];
  }

  getAvailableFileExtensions(): string[] {
    return [...SUPPORTED_FILE_EXTENSIONS];
  }

  private isLeafAllowed(leaf: WorkspaceLeaf | null): boolean {
    const extension = (leaf?.view as WorkspaceLeaf["view"] & {
      file?: { extension?: string };
    })?.file?.extension;

    return typeof extension === "string"
      && this.settings.fileExtensions.includes(extension.toLowerCase());
  }

  private showToggleNotice(message: string): void {
    if (this.settings.showToggleNotices) {
      new Notice(message);
    }
  }

  private reapplyFocusMode(): void {
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

  private getTargetLeaf(): WorkspaceLeaf | null {
    if (this.activeLeaf?.view?.containerEl?.isConnected) {
      return this.activeLeaf;
    }

    return this.app.workspace.activeLeaf ?? null;
  }

  private applyFocusMode(leaf: WorkspaceLeaf): boolean {
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

    let current: HTMLElement | null = contentEl;
    let split: HTMLElement | null = contentEl;

    while (split && !split.classList.contains("workspace-split")) {
      current.classList.add(SHOW_CLASS);
      current = split;
      split = split.parentElement;
    }

    if (current) {
      current.classList.add(SHOW_CLASS);
      current
        .querySelectorAll(`div.workspace-split:not(.${SHOW_CLASS})`)
        .forEach((element) => {
          if (element instanceof HTMLElement && element !== current) {
            element.classList.add(SHOW_CLASS);
          }
        });
      current
        .querySelector(`div.workspace-leaf-content.${SHOW_CLASS} > .view-header`)
        ?.classList.add(SHOW_CLASS);
      current
        .querySelectorAll(`div.workspace-tab-container.${SHOW_CLASS} > div.workspace-leaf:not(.${SHOW_CLASS})`)
        .forEach((element) => {
          if (element instanceof HTMLElement) {
            element.classList.add(SHOW_CLASS);
          }
        });
      current
        .querySelectorAll(`div.workspace-tabs.${SHOW_CLASS} > div.workspace-tab-header-container`)
        .forEach((element) => {
          if (element instanceof HTMLElement) {
            element.classList.add(SHOW_CLASS);
          }
        });
      current
        .querySelectorAll(`div.workspace-split.${SHOW_CLASS} > div.workspace-tabs:not(.${SHOW_CLASS})`)
        .forEach((element) => {
          if (element instanceof HTMLElement) {
            element.classList.add(SHOW_CLASS);
          }
        });
    }

    body
      .querySelectorAll(`div.workspace-split:not(.${SHOW_CLASS})`)
      .forEach((element) => {
        if (!(element instanceof HTMLElement)) {
          return;
        }

        if (element !== split) {
          element.classList.add(HIDE_CLASS);
        } else {
          element.classList.add(SHOW_CLASS);
        }
      });

    body
      .querySelector(`div.workspace-leaf-content.${SHOW_CLASS} > .view-header`)
      ?.classList.add(HIDE_CLASS);
    body
      .querySelectorAll(`div.workspace-tab-container.${SHOW_CLASS} > div.workspace-leaf:not(.${SHOW_CLASS})`)
      .forEach((element) => {
        if (element instanceof HTMLElement) {
          element.classList.add(HIDE_CLASS);
        }
      });
    body
      .querySelectorAll(`div.workspace-tabs.${SHOW_CLASS} > div.workspace-tab-header-container`)
      .forEach((element) => {
        if (element instanceof HTMLElement) {
          element.classList.add(HIDE_CLASS);
        }
      });
    body
      .querySelectorAll(`div.workspace-split.${SHOW_CLASS} > div.workspace-tabs:not(.${SHOW_CLASS})`)
      .forEach((element) => {
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

  private hideSelectors(root: ParentNode, selectors: string[]): void {
    for (const selector of selectors) {
      root.querySelectorAll(selector).forEach((element) => {
        if (element instanceof HTMLElement) {
          element.classList.add(HIDE_CLASS);
        }
      });
    }
  }

  private clearFocusMode(): void {
    this.enabled = false;
    this.activeLeaf = null;
    this.clearMarkedElements();
    this.showNativeStatusBar();
  }

  private getNativeStatusBar(): NativeStatusBarPlugin | null {
    const capacitor = (window as Window & { Capacitor?: CapacitorBridge }).Capacitor;

    if (!capacitor || capacitor.getPlatform?.() === "web") {
      return null;
    }

    return capacitor.Plugins?.StatusBar ?? null;
  }

  private hideNativeStatusBar(): void {
    const statusBar = this.getNativeStatusBar();
    if (!statusBar) {
      return;
    }

    void statusBar.hide().catch((error: unknown) => {
      console.warn("Focus Mode: could not hide the native status bar.", error);
    });
  }

  private showNativeStatusBar(): void {
    const statusBar = this.getNativeStatusBar();
    if (!statusBar) {
      return;
    }

    void statusBar.show().catch((error: unknown) => {
      console.warn("Focus Mode: could not restore the native status bar.", error);
    });
  }

  private clearMarkedElements(): void {
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

  private ensureStyles(): void {
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

  private getContentElement(leaf: WorkspaceLeaf): HTMLElement | null {
    const view = leaf.view as WorkspaceLeaf["view"] & {
      contentEl?: HTMLElement;
    };

    if (view.contentEl instanceof HTMLElement) {
      return view.contentEl;
    }

    const fallback = view.containerEl.querySelector(".workspace-leaf-content");

    if (fallback instanceof HTMLElement) {
      return fallback;
    }

    return view.containerEl;
  }
}

class FocusModeSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly focusModePlugin: FocusModePlugin) {
    super(app, focusModePlugin);
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName("File types")
      .setDesc("Choose which file types use Focus Mode.")
      .setHeading();

    for (const extension of this.focusModePlugin.getAvailableFileExtensions()) {
      new Setting(this.containerEl)
        .setName(`.${extension}`)
        .addToggle((toggle) => {
          toggle
            .setValue(this.focusModePlugin.getSettings().fileExtensions.includes(extension))
            .onChange(async (enabled) => {
              const selected = new Set(this.focusModePlugin.getSettings().fileExtensions);

              if (enabled) {
                selected.add(extension);
              } else {
                selected.delete(extension);
              }

              await this.focusModePlugin.updateSettings({
                fileExtensions: [...selected].sort(),
              });
            });
        });
    }

    new Setting(this.containerEl)
      .setName("Show toggle notifications")
      .setDesc("Show a notice when focus mode is enabled or disabled with the command.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.focusModePlugin.getSettings().showToggleNotices)
          .onChange(async (value) => {
            await this.focusModePlugin.updateSettings({ showToggleNotices: value });
          });
      });
  }
}
