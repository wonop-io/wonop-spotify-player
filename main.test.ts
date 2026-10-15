// The entry, driven the way the core drives it: `app` is stubbed, so this
// needs no isolate, no network and no settings. Run it with
//   deno test --allow-read main.test.ts

function assertEquals<T>(actual: T, expected: T, message = ""): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}
  actual:   ${a}
  expected: ${b}`);
}

async function harness() {
  const h = { spec: null as any, emitted: [] as unknown[][], posts: [] as unknown[] };
  (globalThis as any).app = {
    define(spec: any) { h.spec = spec; },
    emit(...args: unknown[]) { h.emitted.push(args); },
    ui: { post(payload: unknown) { h.posts.push(payload); } },
  };
  await import(`./main.ts#${crypto.randomUUID()}`);
  return h;
}

Deno.test("greet answers and emits what it said", async () => {
  const h = await harness();
  assertEquals(h.spec.commands.greet({ who: "world" }), { said: "hello, world" });
  assertEquals(h.emitted, [["said", "hello, world"]]);
});

Deno.test("text sent to the say input is kept per window", async () => {
  const h = await harness();
  h.spec.onInput({ name: "say", text: "hi", windowId: "w1" });
  assertEquals(h.spec.commands.history({ windowId: "w1" }), { lines: ["hi"] });
  assertEquals(h.spec.commands.history({ windowId: "w2" }), { lines: [] });
});
