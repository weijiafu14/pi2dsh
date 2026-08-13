# Security policy

## Trust boundary

A converted bundle executes a snapshot of the original Pi extension source with the permissions granted to its DSH process. `pi2dsh inspect` reduces accidental incompatibility and supply-chain ambiguity; it is not a malware scanner or an isolation boundary. Review and trust the source before installation, and use DSH sandbox/permission controls appropriate to the deployment.

The converter rejects escaping resource paths, symlinks in copied resource trees, unresolved local module closure, undeclared runtime imports, unknown Pi host exports, dynamic API names it cannot prove, and unsupported capabilities by default.

## Credentials

Never place model or provider keys in generated bundles, reports, issues, or test fixtures. The live acceptance script reads `DEEPSEEK_API_KEY` from process environment, scans captured output/session data for the literal credential, and emits sanitized structural evidence only.

## Reporting a vulnerability

Please use GitHub's private security advisory flow for the repository. Include the affected version, a minimal reproduction, and the security boundary crossed. Do not open a public issue containing an unredacted credential or exploit against a third-party package.
