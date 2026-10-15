// This package works as-is: link it, open it, then edit and watch it reload.
//
// The isolate is long-lived and owns the state; the UI is a view of it. Anything
// registered here is reachable identically from this app's window, the § console,
// an agent script and the WebSocket API.

// One entry per window, because two windows of the same app are two things.
const saidPerWindow = new Map<string, string[]>();

function historyFor(windowId?: string): string[] {
  const id = windowId ?? "unknown";
  if (!saidPerWindow.has(id)) saidPerWindow.set(id, []);
  return saidPerWindow.get(id)!;
}

app.define({
  commands: {
    greet({ who }: { who: string }) {
      const line = `hello, ${who}`;
      app.emit("said", line);
      return { said: line };
    },
    // Whatever this window has been told, so a caller can read state back.
    history({ windowId }: { windowId?: string } = {}) {
      return { lines: historyFor(windowId) };
    },
  },

  onOpen({ windowId }: { windowId: string }) {
    app.ui.post({ type: "hello", lines: historyFor(windowId) }, windowId);
  },

  // `wm.apps.<id>.send("say", "text")` and the UI's own sends land here.
  onInput({ name, text, windowId }: { name: string; text: string; windowId?: string }) {
    if (name !== "say") return;
    historyFor(windowId).push(text);
    app.emit("said", text);
    app.ui.post({ type: "said", text }, windowId);
  },

  onMessage({ payload: msg, windowId }: { payload: any; windowId?: string }) {
    // A UI connected or reloaded: it holds no state of its own, so hand it the
    // history for its window.
    if (msg?.type === "__ui_ready") {
      app.ui.post({ type: "hello", lines: historyFor(windowId) }, windowId);
    }
  },
});
