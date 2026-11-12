// These URLs are loaded by Vite in page.evaluate, outside the Node test module graph.
// Their implementation is typechecked separately in web/tsconfig.tests.json.
declare module "/src/*";
declare module "/tests/*";
declare module "/@react-refresh";
