# Installing JungleMesh on Linux

Two builds are provided. **Prefer the `.deb`** if you are on Debian, Ubuntu, Mint, Zorin, Pop!\_OS or any
derivative: it registers the `junglemesh://` invite links and handles the Chromium sandbox for you.
The AppImage is the fallback for every other distribution.

You can check a download against the SHA-256 shown next to each file on the GitHub release page (`sha256sum <file>`).

## Option A — the .deb (recommended)

```bash
sudo apt install ./JungleMesh-0.1.0.deb
```

Keep the `./` — without it apt looks for a package named `junglemesh` in your repositories.

Then launch **JungleMesh** from your applications menu, or run `junglemesh` in a terminal.

On Ubuntu 24.04 and derivatives you may see `libgtk-3-0` or `libatspi2.0-0` in the dependency list even
though they are not installed under those exact names. That is expected: the `t64` packages shipped by
these releases declare them through `Provides`, so apt resolves them on its own.

To remove it later: `sudo apt remove junglemesh` (your identity and messages are kept, see below).

## Option B — the AppImage (any distribution)

```bash
chmod +x JungleMesh-0.1.0.AppImage
./JungleMesh-0.1.0.AppImage
```

If it fails with an error mentioning **FUSE**, install the FUSE 2 runtime:

- Ubuntu 24.04 / Zorin 18 and newer: `sudo apt install libfuse2t64`
- Older Ubuntu/Debian: `sudo apt install libfuse2`
- Fedora: `sudo dnf install fuse-libs`
- Arch: `sudo pacman -S fuse2`

If it fails with a **sandbox** error instead (something like
`The SUID sandbox helper binary was found, but is not configured correctly` or a message about user
namespaces), your distribution restricts unprivileged user namespaces — this is the default on stock
Ubuntu 24.04. Either install the `.deb`, which fixes this automatically, or start it with:

```bash
./JungleMesh-0.1.0.AppImage --no-sandbox
```

Note that `junglemesh://` invite links are **not** registered by the AppImage. Add friends by pasting
their invite code instead (see below).

## First run

1. Pick a display name on the welcome screen (a picture is optional). This is what your friends see.
2. Open **Settings** (the gear icon) and copy your **invite code** — it never changes.
3. Send that code to your friend by any means you like.
4. When they send you theirs, paste it with the **+** next to FRIENDS, or click their `junglemesh://`
   link if you installed the `.deb`.

Both sides have to confirm, so nobody is added without agreeing to it.

**Make a backup once you have an identity**: Settings › Privacy › Backup. Your identity is a private key
that only exists on your machine — if you lose it, nobody can restore it for you.

## Where your data lives

```
~/.config/junglemesh
```

Note the lowercase name. It holds `profile.json`, your contacts, your rooms and the `corestore/`
database. Deleting that folder erases your identity, so back it up first. Removing the package with
`apt remove` leaves it untouched.

## Known limits on Linux

This is a beta and the Linux build is new. Validated on Zorin OS 18.1 (X11, GNOME): startup, peer-to-peer
connection, friend requests, `junglemesh://` links, tray icon, hardware acceleration.

Not yet tested, so please report what you find:

- **Wayland** sessions — the windows are frameless, so dragging and resizing may misbehave. If something
  looks wrong, try logging into an *Xorg* session from the gear on the login screen.
- **Emoji** need a color emoji font. Ubuntu and Zorin ship one; on other distributions install
  `fonts-noto-color-emoji` (Debian/Ubuntu) or `noto-fonts-emoji` (Arch).
- **Microphone and voice channels.**
- **Desktop notifications.**
- The **tray icon** needs an AppIndicator extension on GNOME (most distributions ship one; Ubuntu and
  Zorin do). Left-clicking it does nothing on Linux — use right-click for the menu.
- Automatic updates are not wired up for Linux yet; new versions have to be installed by hand.

A harmless `MESA-LOADER: failed to open dri_gbm.so` warning on startup can be ignored.
