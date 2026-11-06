function assertEquals<T>(actual: T, expected: T, message = ""): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}\nactual:   ${a}\nexpected: ${b}`);
}

async function assertRejects(fn: () => Promise<unknown>, code: string, text: string) {
  try { await fn(); } catch (error) {
    assertEquals((error as any).code, code);
    if (!(error as Error).message.includes(text)) throw error;
    return;
  }
  throw new Error("Expected command to reject");
}

const FULL_SCOPE = "user-read-playback-state user-modify-playback-state streaming user-read-email user-read-private";
const BASE_SCOPE = "user-read-playback-state user-modify-playback-state";

async function harness(options: {
  connected?: boolean;
  scope?: string;
  connectScope?: string;
  fetchError?: { code: string; message: string };
  responses?: Array<{ status: number; body?: string }>;
  activationError?: { code: string; message: string };
} = {}) {
  const requests: any[] = [];
  const posts: any[] = [];
  const activations: string[] = [];
  const surfacePosts: any[] = [];
  const opens: any[] = [];
  const connects: any[] = [];
  const auth = { connected: options.connected ?? true, scope: options.scope ?? FULL_SCOPE };
  let surfaceListener: ((event: any) => void) | null = null;
  const responses = [...(options.responses ?? [])];
  const h: any = { spec: null, requests, posts, activations, surfacePosts, opens, connects, auth };
  (globalThis as any).app = {
    define(spec: any) { h.spec = spec; },
    oauth: {
      status: async () => ({ connected: auth.connected, redirectUri: "http://127.0.0.1:8888/callback", scope: auth.scope }),
      connect: async (name: string, opts?: any) => {
        connects.push({ name, opts });
        auth.connected = true;
        auth.scope = options.connectScope ?? auth.scope;
        return { connected: true, scope: auth.scope };
      },
      disconnect: async () => ({ connected: false, revoked: false }),
    },
    fetch: async (url: string, init: any) => {
      requests.push({ url, init });
      if (options.fetchError) throw Object.assign(new Error(options.fetchError.message), { code: options.fetchError.code });
      return responses.shift() ?? { status: 204 };
    },
    mediaSurface: {
      open: async (opts: any) => { opens.push(opts); return { handle: "surface-1" }; },
      post: async (_handle: string, message: any) => { surfacePosts.push(message); return { ok: true }; },
      activateFromTrustedGesture: async (handle: string) => {
        activations.push(handle);
        if (options.activationError) throw Object.assign(new Error(options.activationError.message), { code: options.activationError.code });
        return { ok: true };
      },
      state: () => ({ handle: "surface-1", status: "open", windowId: "p1", activated: false }),
      events: async () => [],
      onEvent: (_handle: string, listener: (event: any) => void) => { surfaceListener = listener; return () => {}; },
      close: async () => ({ ok: true }),
    },
    ui: { post(payload: unknown, windowId?: string) { posts.push({ payload, windowId }); } },
  };
  await import(`./main.ts#${crypto.randomUUID()}`);
  h.surfaceEvent = (event: any) => surfaceListener?.(event);
  return h;
}

Deno.test("disconnected status does not call Spotify", async () => {
  const h = await harness({ connected: false });
  assertEquals(await h.spec.commands.status(), { connected: false, redirectUri: "http://127.0.0.1:8888/callback" });
  assertEquals(h.requests, []);
});

Deno.test("now playing is simplified and token stays in the core", async () => {
  const h = await harness({ responses: [{ status: 200, body: JSON.stringify({
    is_playing: true,
    progress_ms: 1200,
    device: { id: "device", name: "Desk", is_active: true },
    item: { id: "track", name: "Song", type: "track", uri: "spotify:track:track", duration_ms: 3000, artists: [{ name: "Artist" }], album: { name: "Album", images: [{ url: "https://image" }] } },
  }) }] });
  const result = await h.spec.commands.nowPlaying();
  assertEquals(result.playback.item.name, "Song");
  assertEquals(result.playback.item.artists, ["Artist"]);
  assertEquals(h.requests[0].init.auth, "spotify");
  assertEquals(h.requests[0].init.headers, undefined);
});

Deno.test("play targets a device and accepts Spotify's empty success", async () => {
  const h = await harness();
  assertEquals(await h.spec.commands.play({ deviceId: "abc 123" }), { ok: true });
  assertEquals(h.requests[0].url, "https://api.spotify.com/v1/me/player/play?device_id=abc%20123");
  assertEquals(h.requests[0].init.method, "PUT");
});

Deno.test("volume validates bounds", async () => {
  const h = await harness();
  await assertRejects(() => h.spec.commands.volume({ percent: 101 }), "invalid_args", "between 0 and 100");
  assertEquals(h.requests, []);
});

Deno.test("missing active device becomes an actionable error", async () => {
  const h = await harness({ responses: [{ status: 404, body: JSON.stringify({ error: { message: "Player command failed" } }) }] });
  await assertRejects(() => h.spec.commands.pause({}), "not_found", "Open Spotify on a device");
});

Deno.test("development-mode refusal explains allowlist and Premium", async () => {
  const h = await harness({ responses: [{ status: 403, body: JSON.stringify({ error: { message: "Forbidden" } }) }] });
  await assertRejects(() => h.spec.commands.devices(), "forbidden", "allowed to use");
});

Deno.test("runtime capabilities are reported by the embedded window", async () => {
  const h = await harness();
  h.spec.onMessage({ payload: { type: "runtime-capabilities", capabilities: { mediaKeys: true, widevine: false } } });
  assertEquals(await h.spec.commands.runtimeCapabilities(), { capabilities: { mediaKeys: true, widevine: false } });
});

Deno.test("search returns only the track fields the window needs", async () => {
  const h = await harness({ responses: [{ status: 200, body: JSON.stringify({ tracks: { items: [{
    id: "t1", uri: "spotify:track:t1", name: "Track", artists: [{ name: "Artist" }],
    album: { name: "Album", images: [{ url: "large" }, { url: "small" }] },
  }] } }) }] });
  const result = await h.spec.commands.search({ query: "track" });
  assertEquals(result.tracks, [{ id: "t1", uri: "spotify:track:t1", name: "Track", artists: [{ id: null, name: "Artist", uri: null }], album: { id: null, name: "Album", artwork: "small" }, durationMs: 0, explicit: false }]);
  if (!h.requests[0].url.includes("/search?type=track,album,artist,playlist&limit=8&q=track")) throw new Error("Search URL was not encoded as expected");
});

Deno.test("surface ready state is available after a window refresh", async () => {
  const h = await harness();
  await h.spec.onOpen({ windowId: "p1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.surfaceEvent({ type: "message", data: { type: "ready", deviceId: "secret-device-id" } });
  const status = await h.spec.commands.surfaceStatus();
  assertEquals(status.surface.deviceReady, true);
  if (JSON.stringify(status).includes("secret-device-id")) throw new Error("Surface status exposed the provider device id");
});

Deno.test("selected track play activates the surface and loads that URI", async () => {
  const h = await harness();
  await h.spec.onOpen({ windowId: "p1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.surfaceEvent({ type: "message", data: { type: "ready", deviceId: "sdk-device" } });
  h.spec.onMessage({ payload: { type: "surface-play", uri: "spotify:track:selected", trace: {
    id: "attempt-1", uiAt: 1234, isTrusted: true,
    selected: { uri: "spotify:track:selected", name: "Selected" },
  } }, windowId: "p1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(h.activations, ["surface-1"]);
  assertEquals(h.requests.at(-1).url, "https://api.spotify.com/v1/me/player/play?device_id=sdk-device");
  assertEquals(JSON.parse(h.requests.at(-1).init.body), { uris: ["spotify:track:selected"] });
  const attempt = (await h.spec.commands.surfaceStatus()).surface.lastPlayAttempt;
  assertEquals(attempt.id, "attempt-1");
  assertEquals(attempt.isTrusted, true);
  assertEquals(attempt.stage, "api-accepted");
  assertEquals(attempt.events.map((event: any) => event.stage), ["handler-received", "activation-requested", "activation-accepted", "api-requested", "api-accepted"]);
});

Deno.test("play without a selection records a correlated visible error", async () => {
  const h = await harness();
  await h.spec.onOpen({ windowId: "p1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.spec.onMessage({ payload: { type: "surface-play", uri: null, trace: {
    id: "attempt-empty", uiAt: 5678, isTrusted: true, selected: null,
  } }, windowId: "p1" });
  const attempt = (await h.spec.commands.surfaceStatus()).surface.lastPlayAttempt;
  assertEquals(attempt.id, "attempt-empty");
  assertEquals(attempt.stage, "missing-selection");
  assertEquals(attempt.code, "invalid_args");
  if (!h.posts.some((post: any) => post.payload?.surface?.status === "play-error")) throw new Error("Missing selection was not surfaced to the window");
});

Deno.test("manual tone arms the same surface before trusted activation", async () => {
  const h = await harness();
  await h.spec.onOpen({ windowId: "p1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.spec.onMessage({ payload: { type: "surface-tone", trace: { id: "tone-1", uiAt: 99, isTrusted: true } }, windowId: "p1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const request = h.surfacePosts.find((message: any) => message.cmd === "arm-tone");
  assertEquals(request.args, { attemptId: "tone-1" });
  assertEquals(h.activations, []);
  h.surfaceEvent({ type: "message", data: { id: request.id, ok: true, result: null } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(h.activations, ["surface-1"]);
  if (!h.posts.some((post: any) => post.payload?.surface?.status === "tone-activation-accepted")) {
    throw new Error("Tone activation acceptance was not surfaced to the window");
  }
});

Deno.test("failed tone activation cancels the armed tone", async () => {
  const h = await harness({ activationError: { code: "gesture_required", message: "expired" } });
  await h.spec.onOpen({ windowId: "p1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  h.spec.onMessage({ payload: { type: "surface-tone", trace: { id: "tone-expired" } }, windowId: "p1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const arm = h.surfacePosts.find((message: any) => message.cmd === "arm-tone");
  h.surfaceEvent({ type: "message", data: { id: arm.id, ok: true, result: null } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const cancel = h.surfacePosts.find((message: any) => message.cmd === "cancel-tone");
  assertEquals(cancel.args, { attemptId: "tone-expired" });
  h.surfaceEvent({ type: "message", data: { id: cancel.id, ok: true, result: null } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!h.posts.some((post: any) => post.payload?.surface?.status === "tone-error")) {
    throw new Error("Failed tone activation was not surfaced");
  }
});

Deno.test("audio diagnostics distinguish fresh null state from cached state", async () => {
  const h = await harness();
  await h.spec.onOpen({ windowId: "p1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pending = h.spec.commands.audioDiagnostics();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const request = h.surfacePosts.find((message: any) => message.cmd === "diagnose");
  h.surfaceEvent({ type: "message", data: { id: request.id, ok: true, result: {
    queriedAt: 2000,
    freshState: { available: true, value: null },
    sdkVolume: { available: true, value: 0.49, observedAt: 2001 },
    cachedState: { observedAt: 1000, paused: false, positionMs: 0 },
    sdkErrors: [{ at: 1999, kind: "playback_error", message: "token=secret https://private.example/credential" }],
    mediaElements: [{ kind: "audio", muted: false, volume: 0.49, paused: false, readyState: 2, networkState: 2, errorCode: 3, src: "https://secret.example/audio?token=x" }],
    unobservable: ["secret internal string"],
  } } });
  const result = await pending;
  assertEquals(result.diagnostics.freshState.value, null);
  assertEquals(result.diagnostics.cachedState.observedAt, 1000);
  assertEquals(result.diagnostics.sdkVolume.value, 0.49);
  assertEquals(result.diagnostics.sdkErrors[0].message, "Spotify could not load or play the track.");
  assertEquals(result.diagnostics.mediaElements[0].errorCode, 3);
  const serialized = JSON.stringify(result);
  for (const secret of ["token=secret", "private.example", "secret.example", "secret internal string"]) {
    if (serialized.includes(secret)) throw new Error(`Diagnostic leaked ${secret}`);
  }
});

Deno.test("audio diagnostics surface sanitized failures", async () => {
  const h = await harness();
  await h.spec.onOpen({ windowId: "p1" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pending = h.spec.commands.audioDiagnostics();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const request = h.surfacePosts.find((message: any) => message.cmd === "diagnose");
  h.surfaceEvent({ type: "message", data: { id: request.id, ok: false, error: { name: "NotSupportedError", message: "Bearer secret at https://private.example/credential" } } });
  await assertRejects(() => pending, "unavailable", "Embedded Spotify diagnostic failed");
});

Deno.test("audio diagnostics reject when the surface is unavailable", async () => {
  const h = await harness();
  await assertRejects(() => h.spec.commands.audioDiagnostics(), "not_found", "not ready");
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const surfaceStatuses = (h: any) => h.posts.map((post: any) => post.payload?.surface?.status).filter(Boolean);

// WON-874: open, start or activate the player when Spotify connects.

Deno.test("connect asks for playback scopes and starts the in-Wonop player", async () => {
  const h = await harness({ connected: false, scope: "", connectScope: FULL_SCOPE });
  const result = await h.spec.commands.connect({}, { windowId: "p1", hostId: "p1", caller: "window" });
  assertEquals(h.connects, [{ name: "spotify", opts: { scopes: ["streaming", "user-read-email", "user-read-private"] } }]);
  assertEquals(h.opens, [{ windowId: "p1" }]);
  assertEquals(result, { connected: true, scope: FULL_SCOPE, player: "opening" });
  h.surfaceEvent({ type: "message", data: { type: "ready", deviceId: "sdk-device" } });
  assertEquals((await h.spec.commands.surfaceStatus()).surface.deviceReady, true);
});

Deno.test("connect from an agent starts the player in the open Spotify window", async () => {
  const h = await harness({ scope: BASE_SCOPE, connectScope: FULL_SCOPE });
  await h.spec.onOpen({ windowId: "p1" });
  await tick();
  assertEquals(h.opens, []);
  const result = await h.spec.commands.connect({}, { windowId: null, hostId: null, caller: "agent" });
  assertEquals(h.opens, [{ windowId: "p1" }]);
  assertEquals(result.player, "opening");
});

Deno.test("consent granted later starts the player without a restart", async () => {
  const h = await harness({ scope: BASE_SCOPE, connectScope: FULL_SCOPE });
  await h.spec.onOpen({ windowId: "p1" });
  await tick();
  assertEquals(surfaceStatuses(h).at(-1), "needs-consent");
  const result = await h.spec.commands.enablePlayback({}, { windowId: null, hostId: null, caller: "agent" });
  assertEquals(h.opens, [{ windowId: "p1" }]);
  assertEquals(result.player, "opening");
});

// WON-874: point to consent or activation before the device is ready.

Deno.test("play before playback consent points to Enable playback", async () => {
  const h = await harness({ scope: BASE_SCOPE });
  await h.spec.onOpen({ windowId: "p1" });
  await tick();
  h.spec.onMessage({ payload: { type: "surface-play", uri: "spotify:track:t1", trace: { id: "a1" } }, windowId: "p1" });
  await tick();
  const error = h.posts.map((post: any) => post.payload?.surface).find((surface: any) => surface?.status === "play-error");
  assertEquals([error.code, error.action], ["needs_consent", "enable-playback"]);
  if (!error.message.includes("Enable playback")) throw new Error(`Consent step not named: ${error.message}`);
  assertEquals(h.activations, []);
  assertEquals(h.requests.filter((request: any) => request.url.includes("/me/player/play")), []);
});

Deno.test("play while the player starts says so instead of failing silently", async () => {
  const h = await harness();
  await h.spec.onOpen({ windowId: "p1" });
  await tick();
  h.spec.onMessage({ payload: { type: "surface-play", uri: "spotify:track:t1", trace: { id: "a2" } }, windowId: "p1" });
  await tick();
  const error = h.posts.map((post: any) => post.payload?.surface).find((surface: any) => surface?.status === "play-error");
  assertEquals(error.code, "starting");
  if (!error.message.includes("Press Play again")) throw new Error(`No next step: ${error.message}`);
  assertEquals(h.activations, []);
  const attempt = (await h.spec.commands.surfaceStatus()).surface.lastPlayAttempt;
  assertEquals(attempt.stage, "readiness-rejected");
});

Deno.test("play reopens a closed player when every grant is in place", async () => {
  const h = await harness();
  await h.spec.onOpen({ windowId: "p1" });
  await tick();
  h.surfaceEvent({ type: "closed", reason: "crashed" });
  h.spec.onMessage({ payload: { type: "surface-play", uri: "spotify:track:t1", trace: { id: "a3" } }, windowId: "p1" });
  await tick();
  assertEquals(h.opens, [{ windowId: "p1" }, { windowId: "p1" }]);
});

// WON-874: a clear Connect prompt when a call fails with `unauthorized`.

Deno.test("an unauthorized fetch becomes a Connect prompt", async () => {
  const h = await harness({ fetchError: { code: "unauthorized", message: "refresh refused" } });
  await assertRejects(() => h.spec.commands.devices(), "unauthorized", "Connect Spotify");
  const prompt = h.posts.find((post: any) => post.payload?.type === "error");
  assertEquals([prompt.payload.code, prompt.payload.action, prompt.windowId], ["unauthorized", "connect", undefined]);
});

Deno.test("Home does not hide a lost sign-in behind empty sections", async () => {
  const h = await harness({ fetchError: { code: "unauthorized", message: "refresh refused" } });
  await assertRejects(() => h.spec.commands.home(), "unauthorized", "Connect Spotify");
});

Deno.test("Spotify's 401 also asks the person to connect again", async () => {
  const h = await harness({ responses: [{ status: 401, body: JSON.stringify({ error: { message: "The access token expired" } }) }] });
  await assertRejects(() => h.spec.commands.nowPlaying(), "unauthorized", "Connect Spotify");
});

Deno.test("an unauthorized play tells the window to show Connect", async () => {
  const h = await harness({ fetchError: { code: "unauthorized", message: "refresh refused" } });
  await h.spec.onOpen({ windowId: "p1" });
  await tick();
  h.surfaceEvent({ type: "message", data: { type: "ready", deviceId: "sdk-device" } });
  h.spec.onMessage({ payload: { type: "surface-play", uri: "spotify:track:t1", trace: { id: "a4" } }, windowId: "p1" });
  await tick();
  const error = h.posts.map((post: any) => post.payload?.surface).find((surface: any) => surface?.status === "play-error");
  assertEquals([error.code, error.action], ["unauthorized", "connect"]);
  const state = h.posts.find((post: any) => post.payload?.type === "error" && post.windowId === "p1");
  assertEquals(state.payload.code, "unauthorized");
});

Deno.test("another fetch failure is not mistaken for a lost sign-in", async () => {
  const h = await harness({ fetchError: { code: "timeout", message: "slow network" } });
  await assertRejects(() => h.spec.commands.devices(), "timeout", "slow network");
  assertEquals(h.posts.filter((post: any) => post.payload?.code === "unauthorized"), []);
});
