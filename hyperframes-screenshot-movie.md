# Screenshot movie of termic via hyperframes (TBD)

Placeholder — fill this in the next time you actually run the workflow, so
it's captured while fresh instead of reconstructed later.

Starting points (from the `hyperframes` / `hyperframes-cli` skills, not yet
verified against a real termic run):

- `npx hyperframes capture` drives a headless/real browser to grab
  screenshots of a running page into a HyperFrames composition.
- termic itself is a Tauri desktop app, not a served web page, so `capture`
  likely needs either the Vite dev server (`npm run tauri:dev` serves the
  webview content on `localhost:1420`) pointed at directly, or a manual
  screen-recording source instead of URL-based capture.
- Once frames/composition exist, `npx hyperframes render` produces the
  final video/GIF.

To fill in for real: run `npx hyperframes init` in a scratch dir, point
`capture` at `localhost:1420` while `npm run tauri:dev` is running, note
what actually works (or doesn't, given it's a native window not a browser
tab), and replace this file with the working steps + exact commands.
