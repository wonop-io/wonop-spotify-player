type SpotifyDevice = {
  id: string | null;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number | null;
  supports_volume: boolean;
};

type Playback = {
  device: SpotifyDevice | null;
  isPlaying: boolean;
  progressMs: number;
  item: null | {
    id: string | null;
    name: string;
    type: string;
    uri: string;
    durationMs: number;
    artists: string[];
    album: string | null;
    artwork: string | null;
  };
};

const API = "https://api.spotify.com/v1";
const SURFACE_SCOPES = ["streaming", "user-read-email", "user-read-private"];
const LIBRARY_SCOPES = ["playlist-read-private", "playlist-read-collaborative", "user-library-read", "user-top-read"];
const LISTENING_SCOPES = ["user-read-recently-played", "user-top-read"];
let runtimeCapabilities: any = null;
let surfaceHandle: string | null = null;
let surfaceWindowId: string | null = null;
let surfaceDeviceId: string | null = null;
let stopSurfaceEvents: (() => void) | null = null;
let lastSurfaceEvent: any = { status: "closed" };
let lastPlayAttempt: any = null;
let nextSurfaceRequestId = 1;
const pendingSurfaceRequests = new Map<number, { resolve: (value: any) => void; reject: (error: any) => void; timer: any }>();

function fail(code: "invalid_args" | "not_found" | "forbidden", message: string): never {
  const error: any = new Error(message);
  error.code = code;
  throw error;
}

function parse(body?: string): any {
  if (!body) return null;
  try { return JSON.parse(body); } catch { return null; }
}

function providerMessage(status: number, body?: string): string {
  const data = parse(body);
  return data?.error?.message || data?.error_description || `Spotify answered ${status}`;
}

function actionable(status: number, body?: string): never {
  const detail = providerMessage(status, body);
  if (status === 401) fail("forbidden", "Spotify authorization expired. Disconnect and connect again.");
  if (status === 403) fail("forbidden", `${detail}. Check that this account is allowed to use the Spotify developer app and that the app owner has Premium.`);
  if (status === 404) fail("not_found", "No controllable Spotify Connect device is available. Open Spotify on a device and start playback once.");
  if (status === 429) fail("forbidden", "Spotify is rate limiting this app. Wait before trying again.");
  fail("forbidden", detail);
}

async function requireConnection(): Promise<void> {
  const state = await app.oauth.status("spotify");
  if (!state.connected) fail("forbidden", "Connect your Spotify account first.");
}

async function spotify(path: string, init: { method?: string; body?: string } = {}): Promise<any> {
  await requireConnection();
  const request: { method?: string; headers?: Record<string, string>; body?: string; auth: string } = {
    ...init,
    auth: "spotify",
  };
  if (init.body) request.headers = { "Content-Type": "application/json" };
  const response = await app.fetch(`${API}${path}`, request);
  if (response.status >= 200 && response.status < 300) return parse(response.body);
  actionable(response.status, response.body);
}

function queryDevice(deviceId?: string): string {
  if (!deviceId) return "";
  const value = deviceId.trim();
  if (!value) fail("invalid_args", "deviceId cannot be empty.");
  return `?device_id=${encodeURIComponent(value)}`;
}

function simplifyPlayback(data: any): Playback | null {
  if (!data) return null;
  const item = data.item;
  return {
    device: data.device ?? null,
    isPlaying: Boolean(data.is_playing),
    progressMs: Number(data.progress_ms ?? 0),
    item: item ? {
      id: item.id ?? null,
      name: item.name ?? "Unknown item",
      type: item.type ?? data.currently_playing_type ?? "unknown",
      uri: item.uri ?? "",
      durationMs: Number(item.duration_ms ?? 0),
      artists: Array.isArray(item.artists) ? item.artists.map((artist: any) => artist.name).filter(Boolean) : [],
      album: item.album?.name ?? null,
      artwork: item.album?.images?.[0]?.url ?? item.images?.[0]?.url ?? null,
    } : null,
  };
}

function simplifyTrack(track: any): any {
  if (!track) return null;
  return {
    id: track.id ?? null,
    uri: track.uri ?? "",
    name: track.name ?? "Unknown track",
    artists: Array.isArray(track.artists) ? track.artists.map((artist: any) => ({ id: artist.id ?? null, name: artist.name ?? "Unknown artist", uri: artist.uri ?? null })) : [],
    album: track.album ? { id: track.album.id ?? null, name: track.album.name ?? "Unknown album", artwork: track.album.images?.[1]?.url ?? track.album.images?.[0]?.url ?? null } : null,
    durationMs: Number(track.duration_ms ?? 0),
    explicit: Boolean(track.explicit),
  };
}

function playlistTotal(item: any): number {
  return Number(item?.items?.total ?? item?.tracks?.total ?? 0);
}

function playlistEntries(item: any): any[] {
  const entries = Array.isArray(item?.items) ? item.items : Array.isArray(item?.items?.items) ? item.items.items : Array.isArray(item?.tracks?.items) ? item.tracks.items : [];
  return entries.map((entry: any) => entry?.item ?? entry?.track ?? entry).filter(Boolean);
}

function simplifyPlaylist(item: any): any {
  return { id: item?.id ?? null, uri: item?.uri ?? null, name: item?.name ?? "Untitled playlist", description: item?.description ?? "", owner: item?.owner?.display_name ?? item?.owner?.id ?? null, artwork: item?.images?.[0]?.url ?? null, trackCount: playlistTotal(item) };
}

function simplifyAlbum(item: any): any {
  return { id: item?.id ?? null, uri: item?.uri ?? null, name: item?.name ?? "Untitled album", artists: Array.isArray(item?.artists) ? item.artists.map((artist: any) => ({ id: artist.id ?? null, name: artist.name ?? "Unknown artist" })) : [], artwork: item?.images?.[0]?.url ?? null, trackCount: Number(item?.total_tracks ?? item?.tracks?.total ?? 0), releaseDate: item?.release_date ?? null, tracks: Array.isArray(item?.tracks?.items) ? item.tracks.items.map(simplifyTrack) : [] };
}

function simplifyArtist(item: any): any {
  return { id: item?.id ?? null, uri: item?.uri ?? null, name: item?.name ?? "Unknown artist", artwork: item?.images?.[0]?.url ?? null, followers: Number(item?.followers?.total ?? 0), genres: Array.isArray(item?.genres) ? item.genres.slice(0, 5) : [], tracks: Array.isArray(item?.tracks) ? item.tracks.map(simplifyTrack) : [] };
}

function requireLibraryScopeHint(error: any): never {
  if (error?.code === "forbidden") fail("forbidden", "Spotify library access needs the optional Library access button and one-time consent.");
  throw error;
}

const DIAGNOSTIC_ERROR_MESSAGES: Record<string, string> = {
  initialization_error: "Spotify player initialization failed.",
  authentication_error: "Spotify player authentication failed.",
  account_error: "The Spotify account is not eligible for embedded playback.",
  playback_error: "Spotify could not load or play the track.",
  autoplay_failed: "The browser blocked automatic playback.",
};

function diagnosticState(value: any): any {
  if (!value || typeof value !== "object") return null;
  const track = value.track && typeof value.track === "object" ? {
    uri: typeof value.track.uri === "string" && value.track.uri.startsWith("spotify:") ? value.track.uri : null,
    name: typeof value.track.name === "string" ? value.track.name.slice(0, 200) : null,
    artists: Array.isArray(value.track.artists) ? value.track.artists.filter((name: any) => typeof name === "string").slice(0, 10).map((name: string) => name.slice(0, 120)) : [],
    album: typeof value.track.album === "string" ? value.track.album.slice(0, 200) : null,
  } : null;
  return {
    observedAt: Number(value.observedAt) || null,
    paused: Boolean(value.paused),
    positionMs: Number(value.positionMs) || 0,
    durationMs: Number(value.durationMs) || 0,
    track,
  };
}

function sanitizeAudioDiagnostics(raw: any): any {
  const safe = raw && typeof raw === "object" ? raw : {};
  const freshAvailable = safe.freshState?.available === true;
  const volume = Number(safe.sdkVolume?.value);
  return {
    queriedAt: Number(safe.queriedAt) || null,
    playerAvailable: safe.playerAvailable === true,
    freshState: freshAvailable
      ? { available: true, value: diagnosticState(safe.freshState?.value) }
      : { available: false, reason: ["player_unavailable"].includes(safe.freshState?.reason) ? safe.freshState.reason : "query_failed" },
    sdkVolume: safe.sdkVolume?.available === true && Number.isFinite(volume)
      ? { available: true, value: Math.min(1, Math.max(0, volume)), observedAt: Number(safe.sdkVolume.observedAt) || null }
      : { available: false, reason: safe.sdkVolume?.reason === "player_unavailable" ? "player_unavailable" : "query_failed" },
    cachedState: diagnosticState(safe.cachedState),
    sdkErrors: Array.isArray(safe.sdkErrors) ? safe.sdkErrors.slice(-10).flatMap((error: any) => {
      const kind = typeof error?.kind === "string" && DIAGNOSTIC_ERROR_MESSAGES[error.kind] ? error.kind : null;
      return kind ? [{ at: Number(error.at) || null, kind, message: DIAGNOSTIC_ERROR_MESSAGES[kind] }] : [];
    }) : [],
    mediaElements: Array.isArray(safe.mediaElements) ? safe.mediaElements.slice(0, 20).map((element: any) => ({
      kind: element?.kind === "video" ? "video" : "audio",
      muted: element?.muted === true,
      volume: Math.min(1, Math.max(0, Number(element?.volume) || 0)),
      paused: element?.paused === true,
      readyState: Math.max(0, Math.min(4, Number(element?.readyState) || 0)),
      networkState: Math.max(0, Math.min(3, Number(element?.networkState) || 0)),
      errorCode: [1, 2, 3, 4].includes(Number(element?.errorCode)) ? Number(element.errorCode) : null,
    })) : [],
    mediaElementScope: "surface document only; Spotify SDK internals may use inaccessible frames/elements",
    runtime: { secureContext: safe.runtime?.secureContext === true, mediaKeys: safe.runtime?.mediaKeys === true },
    unobservable: ["SDK-internal media element mute state", "audio output device and route", "decoded sample flow"],
  };
}

async function currentPlayback(): Promise<Playback | null> {
  return simplifyPlayback(await spotify("/me/player"));
}

function postSurface(update: any): void {
  lastSurfaceEvent = update;
  if (surfaceWindowId) app.ui.post({ type: "surface", surface: update }, surfaceWindowId);
}

function surfaceSnapshot(): any {
  const core = surfaceHandle ? app.mediaSurface.state(surfaceHandle) : { status: "closed", activated: false };
  return { ...lastSurfaceEvent, coreStatus: core.status, activated: core.activated, deviceReady: Boolean(surfaceDeviceId), lastPlayAttempt };
}

function surfaceRequest(cmd: string, args: any = {}): Promise<any> {
  if (!surfaceHandle) fail("not_found", "The in-Wonop Spotify player is not ready.");
  const id = nextSurfaceRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSurfaceRequests.delete(id);
      const error: any = new Error("The embedded Spotify player did not answer the diagnostic request.");
      error.code = "timeout";
      reject(error);
    }, 5000);
    pendingSurfaceRequests.set(id, { resolve, reject, timer });
    void app.mediaSurface.post(surfaceHandle!, { id, cmd, args }).catch((error: any) => {
      clearTimeout(timer);
      pendingSurfaceRequests.delete(id);
      reject(error);
    });
  });
}

function rejectSurfaceRequests(message: string): void {
  for (const pending of pendingSurfaceRequests.values()) {
    clearTimeout(pending.timer);
    const error: any = new Error(message);
    error.code = "closed";
    pending.reject(error);
  }
  pendingSurfaceRequests.clear();
}

function hasSurfaceScopes(scope?: string): boolean {
  const granted = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  return SURFACE_SCOPES.every((value) => granted.has(value));
}

async function openSurface(windowId: string): Promise<void> {
  surfaceWindowId = windowId;
  if (surfaceHandle) return;
  const auth = await app.oauth.status("spotify");
  if (!auth.connected || !hasSurfaceScopes(auth.scope)) {
    postSurface({ status: "needs-consent", requiredScopes: SURFACE_SCOPES });
    return;
  }
  try {
    postSurface({ status: "opening" });
    const opened = await app.mediaSurface.open({ windowId });
    surfaceHandle = opened.handle;
    stopSurfaceEvents = app.mediaSurface.onEvent(opened.handle, (event: any) => {
      if (event.type === "message") {
        const message = event.data;
        if (message && typeof message.id === "number" && pendingSurfaceRequests.has(message.id)) {
          const pending = pendingSurfaceRequests.get(message.id)!;
          clearTimeout(pending.timer);
          pendingSurfaceRequests.delete(message.id);
          if (message.ok) pending.resolve(message.result ?? null);
          else {
            const error: any = new Error("Embedded Spotify diagnostic failed.");
            error.code = "unavailable";
            pending.reject(error);
          }
          return;
        }
        if (!message || typeof message.type !== "string") return;
        if (message.type === "ready" && typeof message.deviceId === "string") surfaceDeviceId = message.deviceId;
        if (message.type === "not-ready") surfaceDeviceId = null;
        console.info("spotify-surface", JSON.stringify({ type: message.type, kind: message.kind ?? null, deviceReady: Boolean(surfaceDeviceId) }));
        postSurface({ status: message.type, ...message, deviceId: message.deviceId ? "available" : undefined });
      } else if (event.type === "error") {
        postSurface({ status: "error", code: event.code, message: event.message });
      } else if (event.type === "closed") {
        rejectSurfaceRequests("The embedded Spotify player closed.");
        surfaceHandle = null;
        surfaceDeviceId = null;
        stopSurfaceEvents = null;
        postSurface({ status: "closed", reason: event.reason });
      }
    });
  } catch (error: any) {
    postSurface({ status: error?.code === "denied" ? "needs-approval" : "error", code: error?.code, message: error?.message });
  }
}

async function surfaceCommand(cmd: string, args: any = {}): Promise<void> {
  if (!surfaceHandle) fail("not_found", "The in-Wonop Spotify player is not ready.");
  await app.mediaSurface.post(surfaceHandle, { id: Date.now(), cmd, args });
}

function recordPlayStage(stage: string, trace: any = {}, detail: any = {}): void {
  const at = Date.now();
  const priorEvents = lastPlayAttempt?.id === trace.id && Array.isArray(lastPlayAttempt.events)
    ? lastPlayAttempt.events
    : [];
  lastPlayAttempt = {
    id: trace.id ?? `isolate-${at}`,
    uiAt: Number(trace.uiAt) || null,
    isTrusted: trace.isTrusted === true,
    selected: trace.selected && typeof trace.selected === "object" ? {
      uri: typeof trace.selected.uri === "string" ? trace.selected.uri : null,
      name: typeof trace.selected.name === "string" ? trace.selected.name : null,
    } : null,
    stage,
    stageAt: at,
    events: [...priorEvents, { stage, at, ...detail }],
    ...detail,
  };
  postSurface({ status: "play-attempt", lastPlayAttempt });
}

async function playInsideWonop(uri: string, trace: any = {}): Promise<void> {
  let phase = "readiness";
  try {
    if (!surfaceHandle || !surfaceDeviceId) fail("not_found", "The in-Wonop Spotify player is not ready yet.");
    phase = "activation";
    recordPlayStage("activation-requested", trace);
    await app.mediaSurface.activateFromTrustedGesture(surfaceHandle);
    recordPlayStage("activation-accepted", trace);
    phase = "spotify-api";
    recordPlayStage("api-requested", trace);
    await spotify(`/me/player/play?device_id=${encodeURIComponent(surfaceDeviceId)}`, {
      method: "PUT",
      body: JSON.stringify({ uris: [uri] }),
    });
    recordPlayStage("api-accepted", trace);
    postSurface({ status: "play-requested" });
  } catch (error: any) {
    recordPlayStage(`${phase}-rejected`, trace, { code: error?.code ?? null, message: error?.message ?? "Playback failed." });
    throw error;
  }
}

async function testSurfaceTone(trace: any = {}): Promise<void> {
  if (!surfaceHandle) fail("not_found", "The in-Wonop Spotify player is not ready yet.");
  const attemptId = typeof trace.id === "string" ? trace.id.slice(0, 80) : `tone-${Date.now()}`;
  postSurface({ status: "tone-arming", attemptId, at: Date.now() });
  await surfaceRequest("arm-tone", { attemptId });
  postSurface({ status: "tone-activation-requested", attemptId, at: Date.now() });
  try {
    await app.mediaSurface.activateFromTrustedGesture(surfaceHandle);
  } catch (error) {
    try { await surfaceRequest("cancel-tone", { attemptId }); } catch { /* Surface teardown also clears it. */ }
    throw error;
  }
  postSurface({ status: "tone-activation-accepted", attemptId, at: Date.now() });
}

async function postState(windowId?: string): Promise<void> {
  try {
    const auth = await app.oauth.status("spotify");
    if (!auth.connected) {
      app.ui.post({ type: "state", connected: false }, windowId);
      return;
    }
    const [playback, deviceData] = await Promise.all([
      currentPlayback(),
      spotify("/me/player/devices"),
    ]);
    app.ui.post({ type: "state", connected: true, playback, devices: deviceData?.devices ?? [] }, windowId);
  } catch (error: any) {
    app.ui.post({ type: "error", message: error?.message ?? "Spotify request failed." }, windowId);
  }
}

app.define({
  commands: {
    async connect() {
      const result = await app.oauth.connect("spotify");
      return { connected: result.connected, scope: result.scope };
    },
    async enablePlayback(_args: any, ctx: any) {
      const result = await app.oauth.connect("spotify", { scopes: SURFACE_SCOPES });
      if (result.connected && ctx?.windowId) await openSurface(ctx.windowId);
      return { connected: result.connected, scope: result.scope };
    },
    async enableLibrary() {
      const result = await app.oauth.connect("spotify", { scopes: LIBRARY_SCOPES });
      return { connected: result.connected, scope: result.scope };
    },
    async enableListening() {
      const result = await app.oauth.connect("spotify", { scopes: LISTENING_SCOPES });
      return { connected: result.connected, scope: result.scope };
    },
    async disconnect() {
      return await app.oauth.disconnect("spotify");
    },
    async status() {
      const auth = await app.oauth.status("spotify");
      if (!auth.connected) return { connected: false, redirectUri: (auth as any).redirectUri };
      return { connected: true, redirectUri: (auth as any).redirectUri, playback: await currentPlayback() };
    },
    async nowPlaying() {
      return { playback: await currentPlayback() };
    },
    async devices() {
      const data = await spotify("/me/player/devices");
      return { devices: data?.devices ?? [] };
    },
    async search({ query }: { query: string }) {
      const value = query?.trim();
      if (!value) fail("invalid_args", "Enter something to search for.");
      const data = await spotify(`/search?type=track,album,artist,playlist&limit=8&q=${encodeURIComponent(value)}`);
      return {
        tracks: Array.isArray(data?.tracks?.items) ? data.tracks.items.map(simplifyTrack) : [],
        albums: Array.isArray(data?.albums?.items) ? data.albums.items.map(simplifyAlbum) : [],
        artists: Array.isArray(data?.artists?.items) ? data.artists.items.map(simplifyArtist) : [],
        playlists: Array.isArray(data?.playlists?.items) ? data.playlists.items.map(simplifyPlaylist) : [],
      };
    },
    async home() {
      const [playlists, featured, recent, top] = await Promise.all([
        spotify("/me/playlists?limit=8").catch(() => ({ items: [], error: true })),
        spotify("/browse/featured-playlists?limit=8").catch(() => ({ playlists: { items: [] }, error: true })),
        spotify("/me/player/recently-played?limit=8").catch(() => ({ items: [], error: true })),
        spotify("/me/top/tracks?limit=8&time_range=medium_term").catch(() => ({ items: [], error: true })),
      ]);
      const recentTracks = (recent?.items ?? []).map((entry: any) => simplifyTrack(entry?.track)).filter(Boolean);
      const topTracks = (top?.items ?? []).map(simplifyTrack).filter(Boolean);
      const status = (items: any[], result: any) => result?.error ? "unavailable" : items.length ? "loaded" : "empty";
      return {
        playlists: (playlists?.items ?? []).map(simplifyPlaylist),
        featured: (featured?.playlists?.items ?? []).map(simplifyPlaylist),
        featuredStatus: status(featured?.playlists?.items ?? [], featured),
        recent: recentTracks,
        recentStatus: status(recentTracks, recent),
        topTracks,
        topTracksStatus: status(topTracks, top),
      };
    },
    async playlists() {
      try { return { playlists: (await spotify("/me/playlists?limit=50")).items?.map(simplifyPlaylist) ?? [] }; }
      catch (error) { return requireLibraryScopeHint(error); }
    },
    async playlist({ id }: { id: string }) {
      if (!id?.trim()) fail("invalid_args", "Choose a playlist first.");
      const playlistId = encodeURIComponent(id);
      const item = await spotify(`/playlists/${playlistId}?fields=id,uri,name,description,images,owner,items(total)`);
      const metadataTotal = playlistTotal(item);
      // Spotify may omit the projected `items.total` on a playlist response even
      // when the account can read its contents. Always query the items resource
      // before declaring a playlist empty.
      const entries: any[] = [];
      let pageTotal = 0;
      let offset = 0;
      do {
        const page = await spotify(`/playlists/${playlistId}/items?limit=100&offset=${offset}`);
        pageTotal = Math.max(pageTotal, playlistTotal(page));
        const pageEntries = playlistEntries(page);
        entries.push(...pageEntries);
        if (!page?.next || pageEntries.length === 0 || (pageTotal > 0 && entries.length >= pageTotal)) break;
        offset += pageEntries.length;
      } while (offset < 1000);
      const tracks = entries.map(simplifyTrack).filter(Boolean);
      const total = Math.max(metadataTotal, pageTotal, tracks.length);
      return { playlist: { ...simplifyPlaylist(item), trackCount: total }, tracks, trackCount: total, contentsStatus: tracks.length ? "loaded" : total > 0 ? "unavailable" : "empty" };
    },
    async album({ id }: { id: string }) {
      if (!id?.trim()) fail("invalid_args", "Choose an album first.");
      const item = await spotify(`/albums/${encodeURIComponent(id)}`);
      return { album: simplifyAlbum(item) };
    },
    async artist({ id }: { id: string }) {
      if (!id?.trim()) fail("invalid_args", "Choose an artist first.");
      const [artist, tracks] = await Promise.all([spotify(`/artists/${encodeURIComponent(id)}`), spotify(`/artists/${encodeURIComponent(id)}/top-tracks?market=US`)]);
      return { artist: { ...simplifyArtist(artist), tracks: (tracks?.tracks ?? []).map(simplifyTrack) } };
    },
    async library() {
      try {
        const [albums, tracks] = await Promise.all([spotify("/me/albums?limit=30"), spotify("/me/tracks?limit=30")]);
        return { albums: albums?.items?.map((entry: any) => simplifyAlbum(entry.album)).filter(Boolean) ?? [], tracks: tracks?.items?.map((entry: any) => simplifyTrack(entry.track)).filter(Boolean) ?? [] };
      } catch (error) { return requireLibraryScopeHint(error); }
    },
    async queue() {
      const data = await spotify("/me/player/queue");
      return { currentlyPlaying: simplifyTrack(data?.currently_playing), queue: (data?.queue ?? []).slice(0, 20).map(simplifyTrack) };
    },
    async runtimeCapabilities() {
      return { capabilities: runtimeCapabilities };
    },
    async surfaceStatus() {
      return { surface: surfaceSnapshot() };
    },
    async audioDiagnostics() {
      return { diagnostics: sanitizeAudioDiagnostics(await surfaceRequest("diagnose")) };
    },
    async transfer({ deviceId, play = false }: { deviceId: string; play?: boolean }) {
      if (!deviceId?.trim()) fail("invalid_args", "Choose a Spotify Connect device.");
      await spotify("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [deviceId], play }) });
      return { ok: true };
    },
    async play({ deviceId }: { deviceId?: string } = {}) {
      await spotify(`/me/player/play${queryDevice(deviceId)}`, { method: "PUT" });
      return { ok: true };
    },
    async pause({ deviceId }: { deviceId?: string } = {}) {
      await spotify(`/me/player/pause${queryDevice(deviceId)}`, { method: "PUT" });
      return { ok: true };
    },
    async next({ deviceId }: { deviceId?: string } = {}) {
      await spotify(`/me/player/next${queryDevice(deviceId)}`, { method: "POST" });
      return { ok: true };
    },
    async previous({ deviceId }: { deviceId?: string } = {}) {
      await spotify(`/me/player/previous${queryDevice(deviceId)}`, { method: "POST" });
      return { ok: true };
    },
    async volume({ percent, deviceId }: { percent: number; deviceId?: string }) {
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) fail("invalid_args", "Volume must be between 0 and 100.");
      const rounded = Math.round(percent);
      const device = deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : "";
      await spotify(`/me/player/volume?volume_percent=${rounded}${device}`, { method: "PUT" });
      return { ok: true, percent: rounded };
    },
    async seek({ positionMs, deviceId }: { positionMs: number; deviceId?: string }) {
      if (!Number.isFinite(positionMs) || positionMs < 0) fail("invalid_args", "Position must be zero or greater.");
      const device = deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : "";
      await spotify(`/me/player/seek?position_ms=${Math.round(positionMs)}${device}`, { method: "PUT" });
      return { ok: true };
    },
    async shuffle({ state: enabled, deviceId }: { state: boolean; deviceId?: string }) {
      const device = deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : "";
      await spotify(`/me/player/shuffle?state=${enabled ? "true" : "false"}${device}`, { method: "PUT" });
      return { ok: true, state: Boolean(enabled) };
    },
    async repeat({ state: repeatState, deviceId }: { state: "off" | "context" | "track"; deviceId?: string }) {
      if (!["off", "context", "track"].includes(repeatState)) fail("invalid_args", "Repeat must be off, context, or track.");
      const device = deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : "";
      await spotify(`/me/player/repeat?state=${repeatState}${device}`, { method: "PUT" });
      return { ok: true, state: repeatState };
    },
  },
  onOpen({ windowId }: { windowId: string }) {
    void postState(windowId);
    void openSurface(windowId);
  },
  onMessage({ payload, windowId }: { payload: any; windowId?: string }) {
    if (payload?.type === "runtime-capabilities") {
      runtimeCapabilities = payload.capabilities ?? null;
      console.info("spotify-runtime-capabilities", JSON.stringify(runtimeCapabilities));
      return;
    }
    if (payload?.type === "surface-play") {
      const trace = payload.trace && typeof payload.trace === "object" ? payload.trace : {};
      if (typeof payload.uri !== "string" || !payload.uri) {
        recordPlayStage("missing-selection", trace, { code: "invalid_args", message: "Search for a track and select it before pressing Play." });
        postSurface({ status: "play-error", code: "invalid_args", message: "Search for a track and select it before pressing Play." });
        return;
      }
      recordPlayStage("handler-received", trace);
      void playInsideWonop(payload.uri, trace).catch((error: any) => postSurface({
        status: "play-error",
        code: error?.code,
        message: error?.code === "gesture_required"
          ? "Playback needs your direct click on Play. Automated clicks cannot unlock protected audio."
          : error?.message,
      }));
      return;
    }
    if (payload?.type === "surface-tone") {
      const trace = payload.trace && typeof payload.trace === "object" ? payload.trace : {};
      void testSurfaceTone(trace).catch((error: any) => postSurface({
        status: "tone-error",
        attemptId: typeof trace.id === "string" ? trace.id.slice(0, 80) : null,
        code: error?.code === "gesture_required" ? "gesture_required" : "unavailable",
        message: error?.code === "gesture_required"
          ? "The test tone needs one direct click in this Spotify window."
          : "The hidden Spotify surface could not run the test tone.",
      }));
      return;
    }
    if (["pause", "resume", "next", "previous"].includes(payload?.type)) {
      void surfaceCommand(payload.type).catch((error: any) => postSurface({ status: "error", code: error?.code, message: error?.message }));
      return;
    }
    if (payload?.type === "surface-volume") {
      void surfaceCommand("volume", { value: Number(payload.value) }).catch((error: any) => postSurface({ status: "error", message: error?.message }));
      return;
    }
    if (payload?.type === "__ui_ready" || payload?.type === "refresh") {
      void postState(windowId);
      if (surfaceWindowId) app.ui.post({ type: "surface", surface: surfaceSnapshot() }, surfaceWindowId);
    }
  },
  onClose() {
    rejectSurfaceRequests("The Spotify window closed.");
    stopSurfaceEvents?.();
    stopSurfaceEvents = null;
    if (surfaceHandle) void app.mediaSurface.close(surfaceHandle);
    surfaceHandle = null;
    surfaceDeviceId = null;
    surfaceWindowId = null;
  },
});
