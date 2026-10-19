# Spotify for Wonop

Connect a Spotify account and use Spotify playback inside Wonop. The package
includes search, Home listening sections, playlists, album/artist details,
library and queue views, a compact synchronized player, and protected Web
Playback SDK audio through Wonop's approved media surface.

## Spotify setup

1. Create an app in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Set the Spotify app client ID and exact redirect URI in `manifest.json`.
3. Add the exact callback URL used by Wonop's OAuth connection to the app's
   redirect URI allowlist. Spotify requires an exact match.
4. In Development Mode, ensure the app owner has Spotify Premium and add each
   intended account to the app's user allowlist (up to five authenticated
   users). Playback control also requires Premium and an available Spotify
   Connect device.
5. Approve the package's Spotify OAuth and `api.spotify.com` permissions in
   Wonop, then choose **Connect Spotify**.

The package requests playback, profile, library, playlist, top-listening and
recently-played scopes. The listening sections require optional
`user-read-recently-played` and `user-top-read` consent. Wonop owns the OAuth
tokens and attaches them to Web API calls; tokens are never exposed to the
package window or command results. Spotify refresh tokens expire after six
months, so an expired connection must be authorized again.

## Verification

Use `wm.dev.test("spotify")` for deterministic command tests and the API check,
then verify Home/search/detail flows and controls with an allowlisted Premium
account. Deno must be installed for the automated test command.
