// Spotify's access token stays inside this isolated media surface and the SDK.
// Never post, log, cache, or display it.
let player = null;
let cachedState = null;
let armedTone = null;
const sdkErrors = [];

function send(type, detail = {}) {
  wonop.post({ type, ...detail });
}

function cleanTrack(track) {
  if (!track) return null;
  return {
    name: track.name || "Unknown track",
    uri: track.uri || "",
    durationMs: Number(track.duration_ms || 0),
    artists: Array.isArray(track.artists) ? track.artists.map((artist) => artist.name).filter(Boolean) : [],
    album: track.album?.name || null,
    artwork: track.album?.images?.[0]?.url || null,
  };
}

function cleanState(state, at) {
  if (!state) return null;
  return {
    observedAt: at,
    paused: Boolean(state.paused),
    positionMs: Number(state.position || 0),
    durationMs: Number(state.duration || 0),
    track: cleanTrack(state.track_window?.current_track),
  };
}

function cleanError(error) {
  const allowed = new Set(["Error", "NotAllowedError", "NotSupportedError", "InvalidStateError", "AbortError", "TimeoutError"]);
  const name = allowed.has(error?.name) ? error.name : "Error";
  return {
    name,
    message: `Spotify SDK diagnostic unavailable (${name}).`,
  };
}

const SDK_ERROR_MESSAGES = {
  initialization_error: "Spotify player initialization failed.",
  authentication_error: "Spotify player authentication failed.",
  account_error: "The Spotify account is not eligible for embedded playback.",
  playback_error: "Spotify could not load or play the track.",
  autoplay_failed: "The browser blocked automatic playback.",
};

async function diagnostics() {
  const queriedAt = Date.now();
  if (!player) return {
    queriedAt, playerAvailable: false, freshState: { available: false, reason: "player_unavailable" },
    sdkVolume: { available: false, reason: "player_unavailable" }, cachedState, sdkErrors: [...sdkErrors],
    mediaElements: [], unobservable: ["SDK-internal media element mute state", "audio output device and route", "decoded sample flow"],
  };
  const [stateResult, volumeResult] = await Promise.allSettled([player.getCurrentState(), player.getVolume()]);
  const mediaElements = Array.from(document.querySelectorAll("audio,video")).map((element) => ({
    kind: element.tagName.toLowerCase(), muted: Boolean(element.muted), volume: Number(element.volume),
    paused: Boolean(element.paused), readyState: Number(element.readyState), networkState: Number(element.networkState),
    errorCode: Number(element.error?.code || 0) || null,
  }));
  return {
    queriedAt,
    playerAvailable: true,
    freshState: stateResult.status === "fulfilled"
      ? { available: true, value: cleanState(stateResult.value, Date.now()) }
      : { available: false, error: cleanError(stateResult.reason) },
    sdkVolume: volumeResult.status === "fulfilled"
      ? { available: true, value: Number(volumeResult.value), observedAt: Date.now() }
      : { available: false, error: cleanError(volumeResult.reason) },
    cachedState,
    sdkErrors: [...sdkErrors],
    mediaElements,
    mediaElementScope: "surface document only; Spotify SDK internals may use inaccessible frames/elements",
    runtime: { secureContext: window.isSecureContext, mediaKeys: typeof navigator.requestMediaKeySystemAccess === "function" },
    unobservable: ["SDK-internal media element mute state", "audio output device and route", "decoded sample flow"],
  };
}

function startDiagnosticTone(attemptId) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    send("tone-result", { attemptId, outcome: "unsupported", at: Date.now(), contextState: "unavailable" });
    return;
  }
  let context;
  try {
    context = new AudioContextClass();
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    gain.gain.value = 0.025;
    oscillator.frequency.value = 440;
    oscillator.type = "sine";
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.65);
    oscillator.addEventListener("ended", () => { void context.close(); }, { once: true });
  } catch (_) {
    void context?.close?.();
    send("tone-result", { attemptId, outcome: "setup-rejected", at: Date.now(), contextState: "unknown" });
    return;
  }
  Promise.resolve(context.resume()).then(
    () => send("tone-result", { attemptId, outcome: "started", at: Date.now(), contextState: String(context.state) }),
    () => {
      send("tone-result", { attemptId, outcome: "resume-rejected", at: Date.now(), contextState: String(context.state) });
      void context.close();
    },
  );
}

window.onSpotifyWebPlaybackSDKReady = () => {
  player = new window.Spotify.Player({
    name: "Wonop Spotify",
    volume: 0.5,
    getOAuthToken(callback) {
      wonop.token("spotify").then(callback, (error) => send("signin-needed", { code: error?.code || "unauthorized" }));
    },
  });

  player.addListener("ready", ({ device_id }) => send("ready", { deviceId: device_id }));
  player.addListener("not_ready", ({ device_id }) => send("not-ready", { deviceId: device_id }));
  player.addListener("player_state_changed", (state) => {
    cachedState = cleanState(state, Date.now());
    send("state", cachedState || { observedAt: Date.now(), paused: true, positionMs: 0, durationMs: 0, track: null });
  });
  for (const kind of ["initialization_error", "authentication_error", "account_error", "playback_error", "autoplay_failed"]) {
    player.addListener(kind, () => {
      const error = { at: Date.now(), kind, message: SDK_ERROR_MESSAGES[kind] };
      sdkErrors.push(error);
      if (sdkErrors.length > 10) sdkErrors.shift();
      send("player-error", error);
    });
  }

  player.connect().then((connected) => send("loaded", { connected: Boolean(connected) }),
    () => send("player-error", { kind: "connect_error", message: "Spotify player could not connect." }));
};

wonop.onMessage(async ({ id, cmd, args } = {}) => {
  if (typeof id !== "number") return;
  try {
    if (cmd === "diagnose") {
      const result = await diagnostics();
      wonop.post({ id, ok: true, result });
      return;
    }
    if (cmd === "arm-tone") {
      const attemptId = typeof args?.attemptId === "string" ? args.attemptId.slice(0, 80) : "tone";
      armedTone = { attemptId, armedAt: Date.now() };
      wonop.post({ id, ok: true, result: null });
      return;
    }
    if (cmd === "cancel-tone") {
      if (!args?.attemptId || armedTone?.attemptId === args.attemptId) armedTone = null;
      wonop.post({ id, ok: true, result: null });
      return;
    }
    if (!player) throw new Error("Spotify player is unavailable.");
    if (cmd === "pause") await player.pause();
    else if (cmd === "resume") await player.resume();
    else if (cmd === "next") await player.nextTrack();
    else if (cmd === "previous") await player.previousTrack();
    else if (cmd === "volume") await player.setVolume(Math.min(1, Math.max(0, Number(args?.value))));
    else throw new Error("Unknown player command");
    wonop.post({ id, ok: true, result: null });
  } catch (error) {
    wonop.post({ id, ok: false, error: cleanError(error) });
  }
});

wonop.onActivate(() => {
  const activationAt = Date.now();
  if (!player) {
    send("sdk-activation", { outcome: "player-unavailable", at: activationAt });
  } else {
    try {
      const activation = player.activateElement();
      Promise.resolve(activation).then(
        () => send("sdk-activation", { outcome: "fulfilled", at: Date.now() }),
        () => send("sdk-activation", { outcome: "rejected", at: Date.now() }),
      );
    } catch (_) {
      send("sdk-activation", { outcome: "rejected", at: Date.now() });
    }
  }
  const tone = armedTone;
  armedTone = null;
  if (tone && Date.now() - tone.armedAt <= 5000) startDiagnosticTone(tone.attemptId);
});
wonop.onClose(() => { player?.disconnect(); });

const sdk = document.createElement("script");
sdk.src = "https://sdk.scdn.co/spotify-player.js";
sdk.onerror = () => send("sdk-failed");
document.head.appendChild(sdk);
