# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.
Email **neuralkink@proton.me** with a description, steps to reproduce and the version you tested.
You will get an answer as soon as possible; this is a spare-time project, so please be patient.

## Privacy and threat model (what JungleMesh does and does not protect)

JungleMesh has no central server, no account, no phone number, no email. Your identity is a key pair generated on your computer.

**What is protected**
- Messages and journals travel over end-to-end encrypted connections (Noise, via Hyperswarm); entries are signed by their author.
- Nothing is loaded from the internet by the interface: strict Content-Security-Policy, no remote images, links are only opened in your browser after confirmation.
- The app is sandboxed (context isolation, no Node.js in the interface, only the microphone permission is granted, DevTools disabled in the installed app, Electron fuses set).
- Everything received from a peer (names, avatars, journal entries, voice signalling) is validated and size-limited; control messages are capped in size and a peer flooding the channel is disconnected.
- **Stealth mode** (Settings › Privacy): only friends and members of your rooms can connect to you. Someone who just has your invite code cannot see you online, learn your IP or your name.
- **Voice relay mode** (Settings › Privacy): all call audio goes through a TURN relay you configure, with no STUN and no direct path, so friends only see the relay's IP. Calls are refused (never silently downgraded) until a relay is set.

**What is NOT hidden (be aware)**
- **Text chat: your IP address is visible to the friends and room members you connect to**, and to the DHT nodes helping peers find each other. The transport (UDP hole punching) cannot go through a proxy, so the app cannot hide it: use a VPN if this matters to you. Stealth mode only limits who can connect.
- **Voice chat** by default uses WebRTC with public STUN servers (Google, Cloudflare) to discover your public address, so those operators can see that an address is making a STUN request, and your friends see your IP. Turn on the voice relay mode to avoid both (you need a TURN server; JungleMesh does not provide one).
- A friend (or room member) can fill your disk by writing a lot into the journals you replicate. There is no quota yet.
- **Removing someone from a room is not cryptographic**: they lose the room in their app, but still know the room key and can follow new messages if they use a modified client. Create a new room to truly exclude someone.
- There is no moderation and no content filter: you only talk to people you chose. Block or leave to cut contact.
- Your public key is a stable identifier: people you share it with can recognise you across rooms.
- Data is stored **unencrypted on disk** in `%APPDATA%\JungleMesh` (use full-disk encryption such as BitLocker). Encrypting the identity key with the OS keychain is planned.
- **Update checks contact GitHub** (at startup and once a day, if the option is on in Settings › Privacy), so GitHub sees your IP address. The app asks before downloading and before installing anything. Until releases are code-signed, the integrity of an update rests on GitHub and on the SHA-512 listed in the release's `latest.yml`: protect the maintainer account with 2FA, and turn the option off if you prefer to update by hand.
- **Identity backups** (Settings › Privacy) are encrypted with a passphrase you choose (scrypt + AES-256-GCM). Anyone who has the file *and* the passphrase becomes you: store both carefully. A weak passphrase can be guessed offline.
- Messages are delivered only between peers that are online at the same time (or on reconnection); there is no server-side storage.

## Supported versions

Only the latest release receives fixes.
