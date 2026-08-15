(draft skeleton - numbers filled from final exercise data before posting)
Title: pi2dsh — run unmodified Pi extensions on DeepSeek Harness (top-50 catalog verified black-box)

Body outline:
- What: general Pi Host ABI over DSH native services; host bundle mounts unmodified Pi packages as npm deps; per-package convert; MCP = config translation to official dsh-mcp-client
- Numbers table (fill): mounted X/50, exercised working Y, callable-needs-config Z, per-layer evidence links
- Honest boundaries: internal-runtime packages, Bun-only deps, TUI decoration no-ops
- Two upstream gaps observed for DSH: out-of-repo SessionEventMap registration + ignorable channel; MCP resources/prompts consumption
- Links: repo, npm, evidence JSONs, acceptance doc
