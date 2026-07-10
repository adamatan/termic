# Screenshot movie of termic via hyperframes (verified)

Task shape: a short explainer video ("HyperFrames movie") for a UI feature
— e.g. a problem slide, a solution slide, real captured footage of the
feature in motion. No product ad/slogan slide at the end.

## HyperFrames CLI: sharp Node-version trap

HyperFrames renders slide-based explainer videos to MP4, but has sharp
Node-version constraints that can silently block the whole pipeline:

- Crashes outright on Node ≥26.
- Requires Node ≥22.12 (tested working: nvm Node v22.23.1).
- Even on a compatible Node version, HyperFrames' `sharp@0.34.x` native
  dependency can fail to build with `Please add node-addon-api`, which
  blocks MP4 render entirely.

**Verify HyperFrames actually renders a test frame before committing to it**
as the pipeline. If `sharp` won't build, fall back to a manual
**ffmpeg + ImageMagick (`magick`)** pipeline — this is what actually
produced the video last time, not the HyperFrames renderer itself.

## Capturing real footage (not mockups)

Capture from the running branch build, using termic's own automation
bridge, not staged screenshots:

- `src-tauri/src/automation.rs` — token-authed HTTP server on localhost,
  armed with `TERMIC_AUTOMATION=1`. Endpoints used: `/screenshot`, `/eval`,
  `/raise`. Can screenshot the app window even when it's off-screen.
- macOS Screen Recording permission must be granted to the **host app**
  that's actually driving the capture — when Claude runs inside
  `/Applications/Termic.app`, grant Screen Recording to `Termic.app`
  itself in System Settings, not to Terminal/iTerm.

### Capturing a CSS animation as real motion (freeze-and-seek)

To capture a CSS animation as motion rather than a single still frame:

1. Set `animation-play-state: paused` on the animated element via `/eval`.
2. Step through phases with a negative `animation-delay` (e.g.
   `-0.1s`, `-0.2s`, ...) to deterministically sample each point in the
   animation — negative delay seeks into the animation timeline instead of
   waiting for it to play.
3. Screenshot each sampled phase via `/screenshot`.
4. Stitch the phase screenshots into the motion sequence downstream (ffmpeg
   image sequence, or as HyperFrames slide frames).

This is deterministic and repeatable, unlike screen-recording a live
animation and hoping to catch the right moment.

## Building slides and assembling the final MP4

1. Build slide PNGs (problem slide, solution slide) and per-theme crops
   with **ImageMagick (`magick`)**.
2. Concatenate everything with **ffmpeg**.
3. **Do not use `ffmpeg -f concat -c copy`** — it produces a QuickTime-black
   file (plays as solid black in QuickTime/most players even though the
   data is technically there). Instead re-encode to a single continuous
   H.264 stream:
   ```
   ffmpeg -f concat -safe 0 -i list.txt \
     -c:v libx264 -profile:v main -pix_fmt yuv420p \
     -movflags +faststart \
     out.mp4
   ```
   `-profile:v main` + `-movflags +faststart` is what makes it play
   everywhere (QuickTime, Slack previews, browsers), not just in ffplay.

## Output conventions

- Everything goes to `/tmp` — do not pollute the repo with scratch frames,
  slide PNGs, or intermediate video files.
- Capture/render at retina resolution.
- Final deliverables: one MP4 + one PNG crop per theme.
