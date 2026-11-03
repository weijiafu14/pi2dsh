The Pi 1.x migration is now available on the `next` channel: **pi2dsh 0.28.0-next.1**, targeting **Pi 1.4.0 and stock DSH 0.2.2-alpha.3** (Node.js 24.9+).

For that DSH version:

```sh
dsh plugin --profile web add pi2dsh@0.28.0-next.1
# Your existing Pi packages remain installed; restart DSH after upgrading.
```

If you use the Web workstation suite, upgrade it instead:

```sh
dsh plugin --profile web add dsh-work-x@0.7.0-next.1
```

The suite pins the matching engine. `latest` remains on the older DSH compatibility line; use the explicit versions above or `@next` for this preview.

This is not just a dependency bump: the bridge now uses native AgentModel selection, the current tool-execution/session APIs, and Pi 1.4 transcript/provider/MCP-registration contracts. The published-package regression results and screenshots are recorded in the [version-specific acceptance report](https://github.com/weijiafu14/pi2dsh/tree/main/community/release-0.28.0-next.1).

Release verification passed: 416 automated tests; the full example battery reported 13 passed, 1 partial and 6 explicitly skipped, with no failures. Real MCP discovery/timeout recovery, Web side conversations, memory/background tasks, code navigation, and an independent headless subagent tool-execution check passed using the published engine. Credential-dependent skips are listed in the report.

The preview does **not** claim the entire new Pi ABI: virtual models, the complete codemode/loadout contract, editable transcript/turn boundaries, and Pi's new image/classifier model operations remain unsupported or partial. The currently checked third-party TUI releases also do not declare compatibility with this DSH alpha; Web/headless validation is separate from them. Existing Pi image-generation tools that own their transport are a different capability from the new standard image-model API.

If a specific Pi package fails on this combination, please share its package/version and the error so we can trace the exact missing contract.
