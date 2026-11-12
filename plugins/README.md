# Vendored yt-dlp plugins

These are third-party yt-dlp plugins, loaded with `--plugin-dirs /app/plugins`.
Each lives in its own directory with its own license; nothing here is part of
Libretech Design's own source.

## bgutil

- Upstream: https://github.com/Brainicism/bgutil-ytdlp-pot-provider
- Commit: `26475e9d3665b972c4aeb83b4dbaafcf64b88438` (2026-10-07), plugin version 2.0.2
- License: GPL-3.0-only (`LICENSE` in this directory)
- Why: generates PO tokens that let yt-dlp request YouTube captions from a
  datacenter address without tripping "Sign in to confirm you're not a bot".
  The token generator runs as a separate container, reached over HTTP at
  `YT_DLP_POT_BASE_URL`; yt-dlp only talks to it over the network, so this is
  aggregation, not linking.

To update: copy `plugin/yt_dlp_plugins` from a newer upstream tag over
`bgutil/yt_dlp_plugins`, refresh `LICENSE`, and update the commit above.
