sections ready: intro/architecture/usage/boundaries/dev-verify both languages drafted mentally;
final assembly waits for definitive exercise numbers (task brr8lztnw)
plan: README.md = English full + language switcher; README.zh.md = Chinese full
progress table (user-specified 3 tiers):
  tier1 已测可用 tested-working = exercise working + executed-input-validation + 4 deep-verified
  tier2 能接入未全测 mounted-not-fully-exercised = loaded but callable-needs-config / failed / nothing-exercisable (nothing-exercisable=event-only packages, work by mounting)
  tier3 未接入 not-yet = 12 (3 internal-API / 7 package-defect / 2 convert-limitation host可救)
roadmap: all 50 targeted — internal-API bridge (AgentSession→ctx.subagents), upstream issues for package defects, host-mode default for snapshot limitation
