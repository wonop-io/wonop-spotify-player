// The `app` global an installed package's `main.ts` is written against.
//
// Unlike `wm.d.ts`, this is hand-authored rather than generated: the surface is
// the `app` object in `wonop-runtime/assets/app_bootstrap.ts`, not a dispatch
// table. A surface test (`apps/desktop/wonop/src-tauri`) checks that every member
// here is present in the bootstrap and vice versa, so the shipped types and the
// runtime cannot drift. This file is the V1 contract — see
// `docs/extension-api-freeze.md`.

// ---- lifecycle handlers (the `app.define` argument) --------------------------

interface AgentMessage {
  id: string;
  from: string;
  text: string;
  subject?: string;
  replyTo?: string;
  payload?: unknown;
}

/** The central MCP servers an agent may use, as its package is told at open
 *  (WON-479). Ids, names and proxied tool names — never a URL or a credential. */
interface AgentMcp {
  servers: { id: string; name: string; tools: string[] }[];
  /** Codex only: servers its own config loads that Settings ▸ MCP does not list. */
  unmanaged?: string[];
}

/** What a command is about (WON-566): the window or tab — an explicit
 *  `tabId`/`windowId`, else a host's active tab, else this package's most
 *  recently focused tab — and who asked. `null` when none applies. */
interface CommandCtx {
  windowId: string | null;
  hostId: string | null;
  caller: string;
}

/** Every inbound handler takes a single object payload, so future context is a
 *  new field rather than a new positional argument. */
interface AppSpec {
  /** Named commands the app answers, matching the manifest's `commands`. A
   *  handler may ignore `ctx`, its second argument. */
  commands?: Record<string, (args: any, ctx: CommandCtx) => unknown>;
  onOpen?: (event: {
    windowId: string;
    agent?: string;
    /** The role this instance was opened or restored with. */
    role?: string;
    roster?: string;
    cwd?: string;
    /** The person chose `cwd`, by creating its workspace (WON-516). */
    cwdTrusted?: boolean;
    /** The central MCP servers this agent may use through Wonop (WON-479). */
    mcp?: AgentMcp;
    /** What the core kept for this window through a restart (WON-483). */
    continuity?: unknown;
    /** The window this one is a tab of; its own id when it is no tab. */
    hostId?: string;
    /** Why it opened (WON-566). */
    reason?: "window" | "newTab" | "script" | "restore";
    /** What it was opened with; on a restore, the saved `restore`. */
    params?: unknown;
  }) => unknown;
  /** The tab its window shows changed; `previous` was showing before. */
  onTabActivate?: (event: { windowId: string; hostId: string; previous?: string }) => unknown;
  /** A tab moved: reordered (`from === to`), into another window, or out
   *  into its own (`to === windowId`). `index` is its place there. */
  onTabMove?: (event: { windowId: string; from: string; to: string; index?: number }) => unknown;
  onReassignRole?: (event: {
    windowId: string;
    role?: string;
    roster?: string;
    mcp?: AgentMcp;
  }) => unknown;
  /** An agent window was renamed: `agent` now, `was` before (still reaches it). */
  onRenameAgent?: (event: { windowId: string; agent: string; was: string }) => unknown;
  onMessage?: (event: { payload: any; windowId?: string }) => unknown;
  /** Text for one of its declared inputs. `windowId` is the tab it is for —
   *  the one named, a host's active tab, or the last focused — and `hostId`
   *  its window. */
  onInput?: (event: { name: string; text: string; windowId?: string; hostId?: string }) => unknown;
  onAgentMessage?: (message: AgentMessage) => unknown;
  onHook?: (event: { name: string; [key: string]: unknown }) => unknown;
  onPtyData?: (event: { ptyId: string; data: string }) => unknown;
  onPtyExit?: (event: { ptyId: string }) => unknown;
  onClose?: (event: { windowId: string }) => unknown;
  /**
   * Its settings were saved (WON-586). The package is not restarted: `config`
   * already holds the new values (the same object, updated in place), and
   * `changed` names the settings whose value moved, with `previous` what they
   * were. Apply what can be applied to open windows. A setting that cannot be
   * is declared `restart: true` in the manifest, and Settings offers the
   * restart.
   */
  onConfigure?: (event: {
    config: Record<string, unknown>;
    changed: string[];
    previous: Record<string, unknown>;
  }) => unknown;
  /** Public mode was switched or its policy changed (WON-473). Redraw. */
  onPublicMode?: (event: PublicMode) => unknown;
  /** One of this package's annotation resources changed elsewhere (WON-528). */
  onAnnotations?: (event: AnnotationsChange) => unknown;
  onStop?: () => unknown;
}

/** Where an annotation points (WON-507, WON-528). */
type AnnotationAnchor =
  | { kind: "element"; selector: string; label?: string; viewport?: unknown }
  | { kind: "region"; page: number; xf: number; yf: number; wf?: number; hf?: number; viewport?: unknown }
  | { kind: "resource"; viewport?: unknown };

/** One annotation in the shared store, as `app.annotations` reads it. */
interface PackageAnnotation {
  id: string;
  /** `app:{packageId}:{key}`. */
  resource: string;
  /** The package's own name for the resource. */
  key: string;
  legacyId?: string | number;
  text: string;
  status: "open" | "resolved";
  created: string;
  updated: string;
  author?: string;
  anchor: AnnotationAnchor;
  unanchored?: boolean;
  replies?: { text: string; author?: string; created: string }[];
  context?: Record<string, unknown>;
}

/** What `onAnnotations` and `app.annotations.onChange` hear. */
interface AnnotationsChange {
  resource: string;
  key: string;
  /** `page`, `resolved`, `reopened` or `cleared`. */
  reason: string;
  windowIds: string[];
}

/** A destination the person approved for a package's `notify` (WON-482). */
interface PackageRoute {
  appId: string;
  key: string;
  workspaceId: string;
  to?: string;
  approvedAt: string;
}

/** One line of the persistent audit log (WON-482). */
interface AuditRecord {
  at: string;
  kind: string;
  action: string;
  recorder?: string;
  recipient?: string;
  subject?: string;
  source?: string;
  approver?: string;
  outcome?: string;
  externalId?: string;
  bodyHash?: string;
  note?: string;
}

/** Public mode (WON-473): the workbench is on a stream or in a screen share. */
interface PublicMode {
  on: boolean;
  /** "strict" also hides every link, long number, amount and random word. */
  strictness: "standard" | "strict";
  /** What to hold back: "secrets" | "emails" | "phones" | "urls" | "financial"
   *  | "accountIds" | "names" | "addresses" | "customers" | "notes". */
  categories: string[];
  /** How long a deliberate reveal (⌥-click on a hidden field) lasts. */
  revealSeconds: number;
}

/** What the moderation gate found in a line (WON-472). */
interface ModerationScan {
  /** Each finding, in order; offsets are UTF-16, as JavaScript counts. */
  findings: {
    start: number;
    end: number;
    /** "emails", "secrets", … for personal data; "slurs", "hate", "sexual",
     *  "gross", "profanity" for words; "blocklist" for the host's own list. */
    category: string;
    source: "private" | "words" | "blocklist";
    severity: "mask" | "block";
    label: string;
  }[];
  /** The line with every finding replaced by its label. */
  masked: string;
}

// ---- return / option shapes -------------------------------------------------

interface PtyHandle {
  ptyId: string;
}
interface BrowserView {
  viewId: string;
}
interface AttachResult {
  attached: boolean;
}
interface NotifyResult {
  id: string;
  state: string;
  deduplicated: boolean;
}
interface SecretValue {
  value: string | null;
}
interface Ok {
  ok: boolean;
}
interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}
interface FetchResult {
  status: number;
  headers: Record<string, string>;
  /** Present unless `{ binary: true }` was requested. */
  body?: string;
  /** Set when a text body was capped. */
  truncated?: boolean;
  /** Present when `{ binary: true }` was requested — the body as a blob. */
  blobHandle?: string;
  bytes?: number;
}
interface CaptureResult {
  handle: string;
  mime: string;
  bytes: number;
}

/** An op error carries a stable machine-branchable `code` alongside its message. */
interface AppError extends Error {
  code: string;
}

/** `app.ai`'s tiers. Chat also has `default`, the assistant's model. */
type AiTier = "cheap" | "medium" | "expensive";

/** What `app.ai.chat` takes. Unknown fields (a `model`, say) are refused. */
interface AiChatRequest {
  tier: AiTier | "default";
  /** Oldest first; the last one is the user's. */
  messages: { role: "user" | "assistant"; content: string }[];
  system?: string;
  /** 0 to 2. */
  temperature?: number;
  /** Chunks as they arrive (the default), or one chunk at the end. */
  stream?: boolean;
}

interface AiChunk {
  text: string;
}

/** How a chat turn ended. No provider or model. */
interface AiChatResult {
  text: string;
  /** "stop" | "length" | "content_filter" | "cancelled" | "other". */
  finishReason: string;
  usage?: { inputTokens: number; outputTokens: number };
}

interface AiChatReply extends AsyncIterable<AiChunk> {
  text(): Promise<string>;
  result(): Promise<AiChatResult>;
  cancel(): void;
}

/** A blob handle (`app.blobs`): bytes held in the core, owned by this package. */
type AiBlobHandle = string;

/** What `app.ai.image.generate` takes (WON-645). Unknown fields are refused. */
interface AiImageGenerateRequest {
  tier: AiTier;
  prompt: string;
  /** `square`, `landscape`, `portrait`, `auto` or `WIDTHxHEIGHT` (64 to 4096).
   *  Left out, the model picks. */
  size?: string;
  /** 1 to 4; 1 when left out. */
  count?: number;
  /** `transparent` for a cutout (a sprite with a real alpha channel),
   *  `opaque`, or `auto`. Only OpenAI GPT image models make a transparent
   *  background; a fal tier refuses it rather than faking one (WON-670). */
  background?: "transparent" | "opaque" | "auto";
}

/** What `app.ai.image.edit` takes. `image` and `mask` are this package's own
 *  PNG, JPEG or WebP blobs; the mask's transparent area is what changes. Not
 *  every tier's model takes a mask (`invalid_input` says so). */
interface AiImageEditRequest {
  tier: AiTier;
  image: AiBlobHandle;
  prompt: string;
  mask?: AiBlobHandle;
  /** As for generate. */
  background?: "transparent" | "opaque" | "auto";
}

/** What `app.ai.image.save` takes (WON-670). */
interface AiImageSaveRequest {
  /** A PNG blob from `app.ai.image` (or `app.blobs.put` with `fallback`). */
  image: AiBlobHandle;
  /** Workspace-relative path ending in `.png`. An existing file is refused:
   *  saved assets are never overwritten. */
  path: string;
  /** Who chose this image, recorded in the manifest. */
  approvedBy?: string;
  note?: string;
  /** Required for an image that did not come from `app.ai.image`: what it is
   *  instead ("drawn by hand", "stock photo"), so it is never passed off as
   *  generated. */
  fallback?: string;
}

/** What `app.ai.image.save` answers, and appends to `assets.json` beside the
 *  file. Size and alpha are read from the written file. */
interface AiImageSaved {
  file: string;
  path: string;
  mime: "image/png";
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  alpha: { channel: boolean; transparentPixels: number; clearPixels: number };
  savedAt: string;
  savedBy: string;
  approvedBy: string | null;
  note: string | null;
  /** The core's record of where the image came from: provider, model, tier,
   *  prompt, background; or `{ source: "fallback", fallback }`. */
  provenance: Record<string, unknown>;
}

/** Images as blob handles; show one with `app.blobs.read(handle)`. */
interface AiImageResult {
  images: AiBlobHandle[];
}

/** What `app.ai.embed` takes. Unknown fields (a `model`, say) are refused. */
interface AiEmbedRequest {
  tier: AiTier;
  /** 1 to 2048 non-empty texts, each at most 32,000 characters. */
  texts: string[];
}

/** One vector per text, in input order, each `dims` long. No provider or model. */
interface AiEmbedResult {
  vectors: number[][];
  dims: number;
}

/** A blob `app.ai` produced: read it with `app.blobs.read(handle)`. */
interface AiBlob {
  handle: string;
  mime: string;
  /** Bytes. */
  size: number;
}

/** A blob a package hands in: its handle, or an object carrying one. */
type AiBlobInput = string | { handle: string };

/** A background job `app.ai` started (video, music). */
interface AiJob {
  jobId: string;
}

/** `app.ai.video.generate`. With `image`, the clip starts from it. */
interface AiVideoRequest {
  tier: AiTier;
  prompt: string;
  /** 1 to 60; each model rounds to the lengths it makes. */
  seconds?: number;
  image?: AiBlobInput;
}

/** `app.ai.video.edit`. */
interface AiVideoEditRequest {
  tier: AiTier;
  video: AiBlobInput;
  prompt: string;
}

/** `app.ai.music.generate`. */
interface AiMusicRequest {
  tier: AiTier;
  prompt: string;
  /** 1 to 600; some models make a fixed length. */
  seconds?: number;
}

/** `app.ai.result`: done with its blob, or (without waiting) still going. */
type AiJobResult =
  | { state: "done"; video?: AiBlob; audio?: AiBlob }
  | { state: "running" | "awaiting_permission" };

/** Task name to the tiers set up for it. */
type AiCapabilities = Record<string, string[]>;

/** An `app.ai` error. `code` is one of six; `retryAfter` (seconds) comes with
 *  `rate_limited` when the provider said. */
interface AiError extends AppError {
  code:
    | "not_configured"
    | "not_permitted"
    | "provider_auth"
    | "rate_limited"
    | "provider_error"
    | "invalid_input";
  retryAfter?: number;
}

// ---- the `app` global -------------------------------------------------------

/** A rendered diagram: the SVG, the language it was read as, and what an
 *  importer could not carry across. */
interface DiagramResult {
  language: string;
  svg: string;
  warnings?: string[];
}

interface AppApi {
  /** Register this app's commands and lifecycle hooks. Call once from `main.ts`. */
  define(spec: AppSpec): void;

  /**
   * Tabs (WON-566), for a package whose manifest declares `tabs`. A tab's
   * `windowId` is the system's and never changes; its title is the package's.
   */
  tabs: {
    /** Open a tab in `hostId`'s window, or a new window without one. */
    open(opts?: { hostId?: string; params?: unknown; activate?: boolean }): Promise<{ windowId: string; hostId: string }>;
    /** Title, icon, unsaved mark, and what to reopen with (≤ 16 KB). */
    set(windowId: string, fields: { title?: string; icon?: string; dirty?: boolean; restore?: unknown }): Promise<{ ok: boolean }>;
    /** Show a tab in its window. */
    activate(windowId: string): Promise<{ tabId: string; hostId: string; previous: string }>;
    /** Close one tab; `e.code === "unsaved"` while dirty, unless `force`. */
    close(windowId: string, opts?: { force?: boolean }): Promise<{ closed: boolean; hostId: string | null }>;
    /** This package's tabs in strip order, of every window or of `hostId`'s. */
    list(hostId?: string): Promise<any[]>;
  };

  ui: {
    /** Push a message to this app's UI; a `windowId` targets one window. */
    post(payload: unknown, windowId?: string): void;
  };

  /** Status line shown in the app's window chrome and the status bar. */
  status(text: string | null): void;

  /**
   * The system agent's name, as the person set it in Settings ("Jenny" until
   * they change it): what chat has to say to reach the assistant. Read it when
   * needed; it can change while the app runs.
   */
  agentName(): string;

  /**
   * Play an effect over the whole workbench, above every window and on stream
   * (WON-465). Requires `permissions.overlay`. The effects are the core's own
   * catalogue; `stop` clears one early. Nothing it plays can take a click.
   * `{ shown: false }` when it came too soon after the last one.
   */
  fx(
    effect: "confetti" | "sparkle" | "niceTry" | "fireworks" | "party" | "stop",
    params?: {
      /** 0.05–1: how much of it. */
      intensity?: number;
      /** 400–8000. */
      durationMs?: number;
      /** A caption of a few words; cut at 48 characters. */
      text?: string;
      sound?: "pop" | "chime" | "none";
      /** 0–1. */
      volume?: number;
      /** Fewer, slower pieces, for reduced motion or a calm stream. */
      lowMotion?: boolean;
    },
  ): { shown: boolean; why?: string };

  /**
   * Call another package's command. Requires its id in `permissions.apps`.
   * Rejects with `code: "not_installed"` when that package is not installed.
   */
  call(appId: string, command: string, args?: unknown): Promise<any>;

  /**
   * Every name that reaches the system agent: each persona's and the legacy
   * ones. What chat routing should listen for; it can change while the app runs.
   */
  agentNames(): string[];

  /**
   * Public mode (WON-473): whether private things must not be shown right now,
   * how strict to be, and what to hold back. Read it when drawing;
   * `onPublicMode` says when it changes.
   */
  publicMode(): PublicMode;

  /**
   * `text` with keys, tokens, emails, phone numbers, private links, card
   * numbers and large amounts replaced by a label while public mode is on;
   * unchanged while it is off. `always` redacts regardless. Keep the original
   * and redact at the moment of drawing.
   */
  redact(text: string, opts?: { always?: boolean }): string;

  /**
   * The moderation gate's text half (WON-472), whatever public mode says:
   * personal data, the shared word list (`words: true`) and the host's
   * `block` list, minus its `allow` list, all read after folding leetspeak and
   * repeated letters. It finds and masks; the verdict — safe, masked, held,
   * blocked — is the package's.
   */
  moderate: {
    scan(
      text: string,
      opts?: { words?: boolean; strict?: boolean; allow?: string[]; block?: string[] },
    ): ModerationScan;
  };

  /**
   * Widget preview: a few short lines shown when this app's window is shrunk to a
   * widget in the field's periphery. `null`/`[]` clears it. Pair with
   * `window.minWidget` in the manifest so the widget stays big enough to read.
   */
  summary(lines: string[] | null, windowId?: string): void;

  /**
   * What this window's gadget card says when it is folded (⇧⌘G): one bright
   * sentence, title or value (`text`) and an optional dim line under it
   * (`detail`), per the style guide. The card's amber dot comes from the
   * window's own needs-you state, not from here. `null` clears it.
   *
   * Pass `windowId` to speak for one window only (WON-523): without it the
   * card is one slot shared by every window of the package. An agent window's
   * `state` drives its status badge; `startedAt` (epoch ms) is when its
   * process started, so an agent's own status from an earlier process is
   * dropped.
   */
  gadget(
    card:
      | {
          text: string;
          detail?: string;
          state?: "working" | "idle" | "waiting" | "error";
          startedAt?: number;
        }
      | { feed: { who: string; text: string }[] }
      | null,
    windowId?: string,
  ): void;

  /** Emit a chunk on one of the manifest's declared output streams. */
  emit(name: string, chunk: string): void;

  /**
   * Pseudo-terminals; requires `permissions.pty`. `agent: true` starts the
   * program as an agent CLI, in the utility class with everything it runs, so
   * many busy agents cannot crowd out Roxy (WON-603); a shell a person types
   * into leaves it unset and keeps the default class.
   */
  pty: {
    open(opts?: { cols?: number; rows?: number; cwd?: string; command?: string; agent?: boolean }): PtyHandle;
    write(ptyId: string, data: string): void;
    resize(ptyId: string, cols: number, rows: number): void;
    close(ptyId: string): void;
  };

  /** Window management; requires `permissions.wm`. */
  wm: {
    windows(): Promise<any[]>;
    move(windowId: string, x: number, y: number): void;
    resize(windowId: string, width: number, height: number): void;
    /** Move and resize as one rect, so a layout's edges meet exactly. */
    setRect(windowId: string, x: number, y: number, width: number, height: number): void;
    focus(windowId: string): void;
    close(windowId: string): void;
    workspace(): Promise<WorkspaceInfo>;
    viewport(): Promise<any>;
  };

  /** Run an external command; requires an `exec` entry in the manifest. */
  exec(
    argv: string[],
    opts?: { cwd?: string; env?: Record<string, string>; timeout?: number; stdin?: string },
  ): Promise<ExecResult>;

  /** HTTP request; the host must be in `permissions.http`. */
  fetch(
    url: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      auth?: string;
      binary?: boolean;
    },
  ): Promise<FetchResult>;

  /** OAuth connections declared under the manifest's `oauth`. */
  oauth: {
    /** `scopes` adds scopes declared under `extraScopes`, one consent each (WON-482). */
    connect(name: string, opts?: { scopes?: string[] }): Promise<{ connected: boolean; scope?: string }>;
    status(
      name: string,
    ): Promise<{ connected: boolean; expiresAt?: number; scope?: string; canRefresh?: boolean }>;
    /** Revokes at the provider when the manifest names a `revokeUrl`, then forgets the tokens. */
    disconnect(name: string): Promise<{ connected: false; revoked: boolean; remoteError?: string }>;
  };

  /** Capture the screen; requires `permissions.screen` and Screen Recording consent. */
  screen: {
    capture(
      opts?:
        | { mode: "interactive" }
        | { mode: "window" }
        | { mode: "display"; display?: number }
        | { mode: "region"; x: number; y: number; width: number; height: number },
    ): Promise<CaptureResult>;
    requestAccess(): void;
  };

  /** The app's own binary blobs, by handle. */
  blobs: {
    put(base64: string, mime: string): { handle: string };
    /**
     * The whole blob as a data URL, or `null` for a handle this package does
     * not own. A blob whose data URL is over 8 MB throws `too_large`: read it
     * in pages instead.
     */
    read(handle: string): { mime: string; size: number; dataUrl: string } | null;
    /**
     * One page of the blob's bytes as base64: at most 3 MB from `offset`
     * (default 0; `length` defaults to and is cut to 3 MB). Go on from
     * `offset + length` while `more` is true. Pages read at the default
     * length join as one base64 string, but hand each page on where you can
     * rather than joining them all: the isolate has 64 MB.
     */
    read(
      handle: string,
      page: { offset?: number; length?: number },
    ): { mime: string; size: number; offset: number; length: number; data: string; more: boolean } | null;
  };

  /** Immutable bytes this package keeps per workspace, with no expiry (WON-669).
   *  The id is the SHA-256; PNG/JPEG/WebP/SVG/static HTML/fonts, 5 MiB at most. */
  assets: {
    put(base64: string, mime: string, name: string): { id: string; hash: string; mime: string; byteLength: number; name: string; fontInfo: unknown };
    read(id: string): { hash: string; mime: string; byteLength: number; name: string; data: string; fontInfo: unknown };
  };

  /** Save bytes where the person chooses, in the native Save panel (WON-669).
   *  PNG or JSON, at most 16 MiB; a file name, never a path. */
  download(base64: string, mime: string, name: string): Promise<{ saved: boolean }>;

  /** Durable JSON documents per workspace, by revision (WON-669). `append`
   *  writes `expectedRevision + 1` or throws `conflict`; every revision is kept. */
  checkpoints: {
    read(key: string): { revision: number; value: unknown };
    append(key: string, expectedRevision: number, value: unknown): { revision: number };
  };

  /** Put something the app produced in front of the assistant; requires `permissions.assistant`. */
  agent: {
    attach(handle: string, opts?: { note?: string }): AttachResult;
    /**
     * An inbox event for `system`; `kind` must be `<package-id>.<name>`.
     * `workspaceId` and `to` are refused unless they match a route the person
     * approved through `requestRoute` (WON-482).
     */
    notify(event: {
      kind: string;
      subject?: string;
      body?: string;
      payload?: unknown;
      dedupeKey?: string;
      wake?: boolean;
      workspaceId?: string;
      to?: string;
    }): NotifyResult;
    /** Ask the person to approve a route for `notify`; resolves with their answer. */
    requestRoute(route: { key: string; workspaceId: string; to?: string }): Promise<{ approved: boolean; already?: boolean; reason?: string | null }>;
    /** This package's approved routes, and the workspaces it may propose one for. */
    routes(): { routes: PackageRoute[]; workspaces: { id: string; name: string }[] };
  };

  /**
   * Ask the person before acting outside the workbench — sending mail, say
   * (WON-482). A card in the inbox and on the pill; never answered
   * automatically; no answer in ten minutes is "no". Requires
   * `permissions.assistant`. The answer is written to the audit log, with a
   * hash of `audit.body`, never the body.
   */
  ask(question: {
    title: string;
    detail?: string[];
    actions?: { value: string; label: string; danger?: boolean }[];
    windowId?: string;
    audit?: { action?: string; recipient?: string; subject?: string; source?: string; body?: string };
  }): Promise<{
    approved: boolean;
    decision: string | null;
    reason: string | null;
    /** Whether the answer reached the audit log. */
    audited?: boolean;
    /** The receipt: `sha256:` of the audit line as written, or null if it was not (WON-669). */
    auditId?: string | null;
  }>;

  /** The persistent audit log, under this package's id as its `kind` (WON-482). */
  audit: {
    /** `body` is hashed and never written. */
    record(entry: {
      action: string;
      recipient?: string;
      subject?: string;
      source?: string;
      approver?: string;
      outcome?: string;
      externalId?: string;
      body?: string;
      note?: string;
    }): AuditRecord;
    /** This package's records, newest first. */
    list(opts?: { limit?: number }): { records: AuditRecord[] };
  };

  /**
   * A push socket the core holds open (`wss://`, host in `http`). With `auth`,
   * the core attaches the provider's token as `tokenParam`; it never enters
   * the app. `read` drains what arrived, oldest first, up to 8 MB of
   * messages a read: with `more: true` the rest is still queued, so read
   * again straight away. `open: false` means it is gone and nothing is left.
   * `dropped` counts messages lost to a full queue (2,000 messages or 64 MB),
   * `oversized` ones too large for any read; both since the last read.
   */
  socket: {
    open(url: string, opts?: { auth?: string; tokenParam?: string }): Promise<string>;
    read(id: string): {
      messages: string[];
      open: boolean;
      more: boolean;
      error: string | null;
      dropped: number;
      oversized: number;
    };
    close(id: string): void;
  };

  /**
   * One AI API (WON-643): a task at a tier, served by the providers the
   * person set up in Settings ▸ AI. No key, provider or model reaches the
   * package. Requires `"permissions": { "ai": [...] }` naming each task it
   * uses (`chat`, `image`, `video`, `music`), approved. Errors
   * are {@link AiError}s.
   */
  ai: {
    /** The tasks and tiers set up now, for the tasks this package may use:
     *  `{ chat: ["default", "medium"] }`. Never a model. */
    capabilities(): Promise<AiCapabilities>;
    /**
     * A chat turn. `for await (const chunk of reply)` reads chunks as they
     * arrive; `await reply.text()` or `await reply.result()` waits for the
     * whole answer; `reply.cancel()` (or leaving the loop early) stops it.
     * `default` is the person's assistant model.
     */
    chat(request: AiChatRequest): AiChatReply;
    /**
     * Images (WON-645). Requires `"image"` in `permissions.ai`. Each call
     * waits for the model, up to five minutes, and is not a background job;
     * results are blobs this package owns, kept ten minutes unless read.
     */
    image: {
      generate(request: AiImageGenerateRequest): Promise<AiImageResult>;
      edit(request: AiImageEditRequest): Promise<AiImageResult>;
      /** Write a chosen image into the workspace as a PNG, with its
       *  checksum, size, alpha and provenance in `assets.json` (WON-670). */
      save(request: AiImageSaveRequest): Promise<AiImageSaved>;
    };
    /**
     * Embeddings (WON-648): `{ vectors, dims }`, one vector per text in
     * order. Requires `"embed"` in `permissions.ai`. A large input is split
     * into batches the provider allows; vectors from different tiers are
     * not comparable, so keep to one tier for one index.
     */
    embed(request: AiEmbedRequest): Promise<AiEmbedResult>;
    /** Video (WON-646), always a durable background job: the call answers
     *  once the provider has accepted it; `result` brings the clip.
     *  Requires `"ai": ["video"]`. */
    video: {
      generate(request: AiVideoRequest): Promise<AiJob>;
      edit(request: AiVideoEditRequest): Promise<AiJob>;
    };
    /** Music (WON-647), a durable background job. Requires `"ai": ["music"]`. */
    music: {
      generate(request: AiMusicRequest): Promise<AiJob>;
    };
    /**
     * A job's result: `{ state: "done", video }` or `{ state: "done", audio }`.
     * Waits for the job unless `{ wait: false }`, which answers `{ state:
     * "running" }` while it runs. A failed job throws its {@link AiError}.
     * A job is cancelled if the package stops; a finished one can be read
     * again for fourteen days (`wm.jobs.result` reads the record).
     */
    result(jobId: string, opts?: { wait?: boolean }): Promise<AiJobResult>;
  };

  /** Web views the app opens and drives; requires `permissions.web`. */
  browser: {
    /** `background` opens it hidden: loaded and drivable, drawn nowhere. */
    open(url: string, opts?: { background?: boolean }): Promise<BrowserView>;
    /** Keep a view running out of sight (to sign in, `show` it again). */
    hide(view: string): void;
    show(view: string): void;
    navigate(view: string, url: string): void;
    back(view: string): void;
    forward(view: string): void;
    reload(view: string): void;
    close(view: string): void;
    eval(view: string, script: string): Promise<any>;
  };

  /** Now-Playing metadata; requires `permissions.media`. */
  media: {
    setNowPlaying(info: {
      title?: string;
      artist?: string;
      album?: string;
      /** A cover image URL (https or data:). The mini-player the workbench draws
       *  for a folded window shows it (WON-455). */
      artwork?: string;
      duration?: number;
      elapsed?: number;
      playing?: boolean;
    }): void;
    clear(): void;
  };

  /**
   * Mermaid or D2 source, rendered to SVG by the core; requires
   * `permissions.diagrams`.
   *
   * Rendering happens in the core rather than in a page on purpose: diagram
   * source in a document is somebody else's text, and the usual way to draw it
   * hands that text to a library running beside your app's bridge. What comes
   * back is markup the core built from a typed graph, so the text never reaches
   * a script engine. Show it through an `<img>` on a `data:` URL rather than
   * inlining the markup, and the guarantee survives a bug in the renderer.
   *
   * `warnings` is what an importer approximated or dropped.
   */
  diagrams: {
    render(language: string, source: string): DiagramResult;
  };

  /** Secrets the app manages itself; each key must be in `permissions.secrets`. */
  secrets: {
    get(key: string): SecretValue;
    set(key: string, value: string): Ok;
    delete(key: string): Ok;
  };

  /**
   * This package's annotations in Wonop's one store (WON-528), under
   * `app:{packageId}:{key}`. Only its own: anything else throws
   * `code: "forbidden"`. With `"annotations": true` in the manifest, its window
   * also gets the comment overlay, filed under what `setResource` says.
   */
  annotations: {
    setResource(windowId: string, key: string | null): { windowId: string; resource: string | null };
    list(opts?: { resource?: string; windowId?: string; status?: "open" | "resolved" }): PackageAnnotation[];
    resolve(id: string, opts?: { reopen?: boolean }): PackageAnnotation;
    add(record: {
      resource?: string;
      windowId?: string;
      text: string;
      author?: string;
      anchor?: AnnotationAnchor;
      status?: "open" | "resolved";
      context?: Record<string, unknown>;
    }): PackageAnnotation;
    reply(id: string, reply: { text: string; author?: string }): PackageAnnotation;
    import(opts: { records: unknown[]; backup?: unknown }): {
      imported: PackageAnnotation[];
      skipped: number;
      backup: string | null;
    };
    onChange(listener: (event: AnnotationsChange) => unknown): void;
  };

  /** A small JSON store that survives a restart and an update. */
  store: {
    get(): any;
    set(value: unknown): void;
    instance(name: string): { get(): any; set(value: unknown): void };
  };
}

/** Git facts about a source folder — present only when the folder is inside a
 *  git repository, so its presence is the answer to "is this a repo?". */
interface GitInfo {
  /** Absolute path of the repository's main working tree — the same value for a
   *  repo's main checkout and every worktree of it, so it identifies the repo. */
  repo: string;
  /** The checked-out branch (or "HEAD" when detached). */
  branch: string;
  /** The `origin` remote's URL, if the repo has one — use it to tell which
   *  project the folder belongs to. Absent for a repo with no `origin`. */
  remote?: string;
  /** True when this folder is the repo's main working tree, not a worktree. */
  primaryCheckout?: boolean;
  /** Changed files in the working tree (staged + unstaged + untracked). */
  dirty?: number;
  /** Commits ahead of / behind the upstream branch; absent/0 when there is none. */
  ahead?: number;
  behind?: number;
}

/** A folder open in the workspace. Named apart from `wm.d.ts`'s
 *  `WorkspaceSource`, whose `kind` and `git` are narrower: a package sees both
 *  globals, and two interfaces of one name with different field types do not
 *  merge, so `main.ts` could not be type-checked against both (WON-318). */
interface AppWorkspaceSource {
  /** `"local"` today; other kinds can appear without the shape changing. */
  kind: string;
  /** Absolute path to the folder. */
  path: string;
  /** The one primary source: the working directory for new terminals and the
   *  default `cwd` for `pty.open` and `exec`. */
  primary: boolean;
  /** Present iff `path` is inside a git repository. */
  git?: GitInfo;
}

/** The workspace this app instance serves. */
interface WorkspaceInfo {
  id: string;
  name: string;
  sources: AppWorkspaceSource[];
}

declare const app: AppApi;
/** The workspace this instance serves, injected by the host. Its `sources` carry
 *  the folder paths and, for any inside a git repo, the branch and `origin`. */
declare const workspace: WorkspaceInfo;
/** Declared config values from the manifest, with any overrides applied.
 *  Updated in place when settings are saved, before `onConfigure` runs, so
 *  reading `config.x` when it is needed always sees what is in force. */
declare const config: any;
