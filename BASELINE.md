# RustIQ fork baseline

Captured on 2026-07-21 before runtime dependency changes.

## Source

- Working baseline: `089cfd3db1b04709911948bce669273139c6a124`
- Commit subject: `Revert bandaid solution`
- Local branch: `security/runtime-deps`
- Origin: `MrMakaroni/rustplus-rustiq`
- Origin `master` at capture time: `85f3e09db24a7ada0273e73742e6704d238bd761`
- Baseline source branch: `origin/temp-fix-message-error`
- Comparison remotes: `alex-upstream` and `liam-upstream`

## Runtime

- Local Node.js: `v26.0.0`
- Local npm: `11.12.1`
- Production Node.js version: `v20.20.2`
- Clean install: `npm ci` succeeded
- Syntax checks: `node --check rustplus.js` and `node --check camera.js` succeeded

## Direct dependency tree

| Package | Resolved version |
| --- | --- |
| `@liamcottle/push-receiver` | `0.0.3` |
| `axios` | `1.7.7` |
| `chrome-launcher` | `0.15.2` |
| `command-line-args` | `5.2.1` |
| `command-line-usage` | `6.1.3` |
| `express` | `4.20.0` |
| `jimp` | `0.22.12` |
| `protobufjs` | `7.4.0` |
| `uuid` | `9.0.1` |
| `ws` | `8.18.0` |

The nested `@liamcottle/push-receiver@0.0.3` additionally resolves
`protobufjs@6.11.4`, `request@2.88.2`, `request-promise@4.2.6`, and two
paths to `uuid@3.4.0`.

## Security baseline

An online `npm audit --json` reported 26 vulnerabilities: 4 low, 13 moderate,
6 high, and 3 critical. Direct vulnerable packages include
`@liamcottle/push-receiver`, `axios`, `express`, `jimp`, `protobufjs`, `uuid`,
and `ws`. The push receiver has no automatic npm fix and is the reason for the
separate `MrMakaroni/push-receiver-rustiq` fork.

## RustIQ contract in scope

- Constructor: `new RustPlus(...)`
- Connection: `connect()`, `disconnect()`, `isConnected()`
- Events: `on()`, `off()`
- Requests: `sendRequestAsync()`
- Pairing dependency: `AndroidFCM.register()` from push receiver

The previously referenced 57 RustIQ tests live outside this repository and
cannot be run here until the RustIQ integration checkout is supplied.

## Current working result

- Contract tests: 8/8 passing
- Core runtime no longer loads the Jimp/camera stack until `getCamera()`
- `isConnected()` safely returns `false` before connection and after disconnect
- timed-out async requests remove their registered callbacks
- Updated: `axios@1.18.1`, `express@4.22.2`, `protobufjs@7.6.5`,
  `uuid@11.1.1`, and `ws@8.21.1`
- Jimp is now an optional peer dependency and is absent from the core install
- Both production-only and full online npm audits report 0 vulnerabilities
- CI contract matrix added for Node.js 20 and 22
- Production runtime confirmed as Node.js `v20.20.2`
- Push receiver is vendored from exact fork commit
  `76b0e81302d9194f97f4f06acb454ef6d4d29e96`
- The core install is self-contained and does not require cross-repository
  GitHub credentials; package-lock integrity protects the vendored tarball
