# RustPlus Runtime for RustIQ

[![CI](https://github.com/MrMakaroni/rustplus-rustiq/actions/workflows/ci.yml/badge.svg)](https://github.com/MrMakaroni/rustplus-rustiq/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-%3E%3D20.20.2-339933?logo=node.js&logoColor=white)](./package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Rust+ WebSocket and protobuf runtime maintained for
[RustIQ](https://rust-iq.com).

This is an independent, unofficial fork built for RustIQ's long-running server
connections, team chat, map data, events, and smart-device automation. It is
not produced by or affiliated with Facepunch Studios.

## Fork lineage

RustIQ did not replace the protocol implementation and does not claim its
original authorship. The repository lineage is:

1. [`liamcottle/rustplus.js`](https://github.com/liamcottle/rustplus.js) —
   original Rust+ JavaScript library and protobuf work by Liam Cottle and its
   contributors;
2. [`alexemanuelol/rustplus.js`](https://github.com/alexemanuelol/rustplus.js)
   — the production-compatible baseline previously used by RustIQ;
3. `MrMakaroni/rustplus-rustiq` — current runtime maintenance, dependency
   hardening, reproducible push-receiver snapshot, and RustIQ contract tests.

The upstream copyright and MIT license remain intact.

## What RustIQ maintains

- Node.js 20.20.2+ runtime support;
- current `ws`, `protobufjs`, `axios`, `uuid`, and related dependencies;
- a self-contained snapshot of
  [`push-receiver-rustiq`](https://github.com/MrMakaroni/push-receiver-rustiq);
- bounded MCS parsing, abort-aware check-in, and deterministic reconnect
  cleanup for the pairing CLI path;
- lazy optional camera support so the core runtime does not load Jimp;
- compatibility tests for RustIQ's actual API surface;
- clean production and development npm audits at the current release.

The exact dependency and source baselines are documented in
[BASELINE.md](./BASELINE.md) and [vendor/README.md](./vendor/README.md).

## Install reproducibly

This fork is consumed from an immutable GitHub archive rather than the upstream
npm package:

```json
{
  "dependencies": {
    "@liamcottle/rustplus.js": "https://github.com/MrMakaroni/rustplus-rustiq/archive/<commit-sha>.tar.gz"
  }
}
```

Pin a full reviewed commit SHA. Avoid production dependencies on `master` or a
feature branch.

## Supported RustIQ contract

RustIQ deliberately relies on a small stable core:

```js
const RustPlus = require('@liamcottle/rustplus.js');

const rustplus = new RustPlus(host, appPort, steamId, playerToken);

rustplus.on('connected', async () => {
  const info = await rustplus.sendRequestAsync({ getInfo: {} });
  console.log(info);
});

rustplus.on('message', (message) => {
  // Responses and Rust+ broadcasts arrive here.
});

rustplus.connect();

// Later:
rustplus.disconnect();
```

The compatibility suite guarantees the constructor plus these methods and
event helpers:

- `connect()` and `disconnect()`;
- `isConnected()`;
- `on()` and `off()`;
- `sendRequestAsync()`;
- protobuf encode/decode for `AppRequest` and `AppMessage`;
- callback cleanup after timeout or disconnect.

The inherited convenience methods remain available, including server info,
time, team info, map, map markers, team chat, entity reads, and smart-device
updates. Rust server rate limits and permissions still apply.

The RustIQ fork also tracks the current team-management and clan protocol:

- `promoteToLeader(steamId)` transfers team leadership;
- `kickFromTeam(steamId)` removes a teammate, or leaves the team when passed
  the paired player's own Steam ID;
- `getClanInfo()`, `getClanChat()`, `sendClanMessage()`, and `setClanMotd()`;
- current clan score, leaderboard, score-event, role-permission, and manager
  protobuf messages.

## Pairing and credentials

A connection requires the Rust server address, `app.port`, Steam ID, and a
valid player token produced by Rust+ pairing. Treat all pairing artifacts as
secrets.

The included CLI retains FCM registration and listening commands for local
operator workflows:

```bash
git clone https://github.com/MrMakaroni/rustplus-rustiq.git
cd rustplus-rustiq
npm ci
node cli/index.js fcm-register
node cli/index.js fcm-listen
```

Chrome is required for the interactive registration flow. Never commit the
generated config file or reuse production pairing credentials in a concurrent
test listener.

## Optional camera support

Camera decoding is intentionally outside the core dependency path. Install the
compatible Jimp peer only when camera functionality is required:

```bash
npm install jimp@^0.22.12
```

Server, map, team chat, pairing, and smart-device functions do not require it.

## Development

```bash
npm ci
npm test
npm audit
```

CI runs the contract suite on Node.js 20 and 22. Changes to protobuf framing,
connection lifecycle, or the vendored receiver should also be verified against
a real test server before release.

## Project boundaries

- Unofficial community software; not affiliated with Facepunch Studios or the
  official Rust+ application.
- Intended for authorized accounts and servers only.
- No warranty is provided for protocol changes, game updates, or account
  enforcement decisions.
- Rust and Rust+ are trademarks of their respective owners.

## Credits and license

Thanks to Liam Cottle and every upstream contributor who developed and
documented the original protocol library, and to the maintainers of the
intermediate fork used as RustIQ's production baseline.

RustIQ-specific maintenance is developed in this repository. The project is
distributed under the [MIT License](./LICENSE), with original notices retained.
