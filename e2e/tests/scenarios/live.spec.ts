// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Define an individual test case.
test.beforeEach(async ({ page }) => {
  await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><main id='root'></main>" }));
  await page.goto("/__scenario");
  await page.evaluate(async () => {
    const refresh = await import(/* @vite-ignore */ String("/@react-refresh"));
    refresh.default.injectIntoGlobalHook(window);
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
  });
});
// Case: reconnect catch-up and busy event update visible screen.
test("reconnect catch-up and busy event update visible screen", async ({ page }) => {
  await page.evaluate(async () => {
    const w = window as any;
    w.streams = []; w.streamCalls = 0;
    window.fetch = (async (_input: any, init: any) => {
      w.streamCalls++;
      return new Response(new ReadableStream({ start(controller) { w.streams.push(controller); init?.signal?.addEventListener("abort", () => { try { controller.close(); } catch {} }); } }), { status: 200 });
    }) as typeof fetch;
    w.harness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountLiveRefresh();
  });
  await expect(page.getByTestId("value")).toHaveText("initial");
  await page.evaluate(() => { const w = window as any; w.harness.server("during-disconnect"); w.streams[0].enqueue(new TextEncoder().encode('event: connected\ndata: {"ok":true}\n\n')); });
  await expect(page.getByTestId("value")).toHaveText("during-disconnect");
  await page.evaluate(() => { const w = window as any; w.harness.busy(true); });
  await expect(page.getByTestId("busy")).toHaveText("true");
  await page.evaluate(() => { const w = window as any; w.harness.server("changed-while-busy"); w.streams[0].enqueue(new TextEncoder().encode('event: ticket.changed\ndata: {"ticketId":"ticket"}\n\n')); });
  await page.evaluate(() => (window as any).harness.busy(false));
  await expect(page.getByTestId("value")).toHaveText("changed-while-busy");
  await page.evaluate(() => { const w = window as any; w.harness.server("missed-on-real-reconnect"); w.streams[0].close(); });
  await expect.poll(() => page.evaluate(() => (window as any).streamCalls)).toBe(2);
  await page.evaluate(() => { const w = window as any; w.streams[1].enqueue(new TextEncoder().encode('event: connected\ndata: {"ok":true}\n\n')); });
  await expect(page.getByTestId("value")).toHaveText("missed-on-real-reconnect");
  await page.evaluate(() => (window as any).harness.stop());
});
// Case: split UTF-8/CRLF preserves Bulgarian; subscribers share stream and cancel reconnect.
test("split UTF-8/CRLF preserves Bulgarian; subscribers share stream and cancel reconnect", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const w = window as any; const controllers: ReadableStreamDefaultController[] = []; let calls = 0; let aborts = 0;
    const fetchOriginal = window.fetch;
    window.fetch = (async (_input: any, init: any) => { calls++; return new Response(new ReadableStream({ start(c) { controllers.push(c); init?.signal?.addEventListener("abort", () => { aborts++; try { c.close(); } catch {} }); } })); }) as typeof fetch;
    const { subscribeLiveEvents } = await import(/* @vite-ignore */ "/src/api/liveEvents.ts");
    const a: any[] = []; const b: any[] = [];
    const offA = subscribeLiveEvents((event: any) => a.push(event)); const offB = subscribeLiveEvents((event: any) => b.push(event));
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise(r => setTimeout(r, 0));
    const bytes = new TextEncoder().encode('event: ticket.changed\r\ndata: {"ticketId":"Стая Жълта"}\r\n\r\nevent: location.changed\ndata: {"locationId":"България"}\n\nevent: cleaning.changed\ndata: {"taskId":"incomplete"}');
    for (const byte of bytes) controllers[0]!.enqueue(new Uint8Array([byte]));
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise(r => setTimeout(r, 10));
    offA(); const afterOne = aborts;
    // Brief yield so lock waiters/UI can settle before asserting.
    controllers[0]!.enqueue(new TextEncoder().encode('\n\n')); await new Promise(r => setTimeout(r, 10));
    // Brief yield so lock waiters/UI can settle before asserting.
    controllers[0]!.close(); await new Promise(r => setTimeout(r, 0)); offB();
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise(r => setTimeout(r, 1100)); window.fetch = fetchOriginal;
    return { calls, aborts, afterOne, a, b };
  });
  expect(result.calls).toBe(1); expect(result.afterOne).toBe(0);
  expect(result.a.map(e => [e.type, e.ticketId ?? e.locationId])).toEqual([["ticket.changed", "Стая Жълта"], ["location.changed", "България"]]);
  expect(result.b.map(e => e.type)).toEqual(["ticket.changed", "location.changed", "cleaning.changed"]);
});
