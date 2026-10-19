# Wonop Playback design

## Direction

A Spotify-style desktop workspace: a stable library sidebar, discovery/search
content in the main pane, and a compact persistent player anchored to the
bottom. The listening surface should feel like a music product, not a device
diagnostic console.

## Visual system

- Carbon background: `#090b0a`
- Raised surfaces: `#121513` and `#191d1a`
- Primary text: `#f7faf7`; secondary text: `#aeb7b0`
- Spotify signal green: `#1ed760`; use it for connection and primary action
- Hairline borders use translucent white; corners are 10–18 px
- System UI sans, with dense negative tracking only on track/display titles
- Icons are authored SVGs with one consistent compact geometry

## State hierarchy

1. Library and navigation remain available at the left edge
2. Discovery, search results, and detail pages own the main pane
3. Now-playing identity and transport stay persistent at the bottom
4. Device and volume controls remain compact and contextual
5. Consent and empty states explain the next supported action

The no-device state keeps the compact player visible, disables only controls
that require a target, and explains that system audio hardware is not a
Spotify Connect device. Never route to an external player as a workaround.

## Interaction

Controls disable when Spotify reports no usable device. Device state refreshes
while the window is open and can be checked manually. Errors name the problem
and the next action. Keyboard focus is always visible; reduced-motion settings
remove transitions and animation.
