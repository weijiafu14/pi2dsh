# DeepSeek Harness × Pi/pi2dsh architecture feasibility — 1,123-thread audit

Captured: 2026-08-23T10:04:14.701Z. Finalized: 2026-08-24T13:09:48.194Z.

Every bug/feature/question/documentation thread that the first full audit mapped to a Pi product line entered this second-pass denominator. No product line was removed because another developer owns it. Every item has a first verdict, an adversarial challenge, and — when still core-only — an alternate-path recovery audit.

## Denominator and final verdict

| Population | Unique discussions |
|---|---:|
| All captured Discussions | 4149 |
| Actual bug/feature/question/documentation threads | 2789 |
| Pi/pi2dsh-mapped problem threads audited one by one | 1123 |
| Solvable without a DSH upstream change | **283** |
| Solvable after a narrow DSH public seam | **58** |
| No honest plugin/product alternate for the required semantics | 782 |

| Verdict | Threads | Meaning |
|---|---:|---|
| ready_now | 108 | Current repository evidence supports a targeted alternate reply now |
| e2e_only | 51 | Implementation path exists; exact named scenario must pass clean DSH E2E |
| pi2dsh_adapter_work | 39 | A public DSH seam and mature Pi API exist; standard Host ABI mapping is missing |
| pi_product_work | 74 | DSH seams are sufficient; the Pi/adjacent product needs a feature |
| multi_product_composition | 11 | Two or more existing products must be composed and tested |
| dsh_public_seam_needed | 58 | A narrow upstream public seam is required before a plugin can complete it |
| dsh_core_only | 782 | The required core parser/history/install/security/global-UI semantic cannot be honestly replaced |

## Product lines — deduplicated primary ownership

| First-pass product line | Total | Ready | E2E | Adapter | Product | Composition | DSH seam | Core only |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ui_tui | 256 | 5 | 1 | 1 | 7 | 0 | 15 | 227 |
| provider_model | 255 | 38 | 36 | 23 | 15 | 1 | 8 | 134 |
| session_search_memory | 117 | 1 | 1 | 1 | 6 | 0 | 7 | 101 |
| permission_sandbox | 115 | 1 | 0 | 0 | 4 | 0 | 1 | 109 |
| subagents | 72 | 25 | 3 | 0 | 4 | 1 | 6 | 33 |
| skills_prompt_migration | 69 | 3 | 2 | 5 | 3 | 0 | 8 | 48 |
| multimodal_imagegen | 50 | 18 | 3 | 1 | 4 | 1 | 3 | 20 |
| mcp_adapter | 40 | 2 | 3 | 6 | 1 | 1 | 6 | 21 |
| code_file_tools | 37 | 0 | 0 | 1 | 6 | 0 | 0 | 30 |
| remote_voice_im | 33 | 6 | 0 | 0 | 5 | 6 | 1 | 15 |
| hermes_memory_learning | 23 | 5 | 0 | 0 | 11 | 0 | 2 | 5 |
| goal_list_loop_audit | 18 | 0 | 0 | 0 | 2 | 0 | 0 | 16 |
| web_access_research | 16 | 4 | 1 | 1 | 3 | 0 | 0 | 7 |
| background_tasks_fusion | 16 | 0 | 1 | 0 | 1 | 0 | 0 | 14 |
| pi_lens_code_intelligence | 4 | 0 | 0 | 0 | 1 | 0 | 1 | 2 |
| agent_browser_native | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| fabric_agent_runtime | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 |

## Cross-cluster product programs

These programs restore the intersections that one-primary-product classification intentionally removed. Counts remain unique because every engineering cluster belongs to one program here.

| Rank | Product program | New work | Already ready | DSH seam | Core only | Total mapped |
|---:|---|---:|---:|---:|---:|---:|
| 1 | provider_interoperability | **78** | 27 | 9 | 133 | 247 |
| 2 | agent_runtime_continuity | **29** | 32 | 15 | 139 | 215 |
| 3 | client_remote_interaction | **21** | 7 | 19 | 146 | 193 |
| 4 | knowledge_code_workflows | **20** | 8 | 3 | 60 | 91 |
| 5 | multimodal_media | **9** | 28 | 2 | 19 | 58 |
| 6 | mcp_ecosystem | **8** | 2 | 5 | 20 | 35 |
| 7 | sandbox_remote_execution | **5** | 0 | 1 | 92 | 98 |
| 8 | plugin_install_runtime | **3** | 0 | 3 | 24 | 30 |
| 9 | host_core_misc | **2** | 4 | 1 | 149 | 156 |

## Development priority — newly unlockable threads per median cluster cost

This ranks remaining work, not total topical mentions. `new` excludes already-ready replies; cost weights are xs=1, s=2, m=4, l=8, xl=16.

| Rank | Engineering cluster | New | Already ready | DSH seam | Core only | Median cost weight | Score |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | provider_gateway_catalog | 29 | 27 | 5 | 41 | 2 | 14.5 |
| 2 | provider_reasoning_compat | 12 | 0 | 0 | 36 | 2 | 6 |
| 3 | provider_retry_errors | 11 | 0 | 0 | 10 | 2 | 5.5 |
| 4 | multimodal_admission_generation | 9 | 28 | 2 | 19 | 2 | 4.5 |
| 5 | mcp_runtime | 8 | 2 | 5 | 20 | 2 | 4 |
| 6 | session_import_search | 6 | 1 | 7 | 76 | 2 | 3 |
| 7 | memory_learning | 11 | 5 | 2 | 3 | 4 | 2.75 |
| 8 | ui_client_extension | 10 | 1 | 18 | 133 | 4 | 2.5 |
| 9 | provider_request_metadata | 10 | 0 | 2 | 16 | 4 | 2.5 |
| 10 | provider_tool_stream | 10 | 0 | 1 | 17 | 4 | 2.5 |
| 11 | web_search_browser | 5 | 5 | 0 | 7 | 2 | 2.5 |
| 12 | file_context_diff | 4 | 0 | 0 | 18 | 2 | 2 |
| 13 | skills_config_migration | 7 | 2 | 0 | 22 | 4 | 1.75 |
| 14 | remote_im_voice | 7 | 4 | 1 | 3 | 4 | 1.75 |
| 15 | subagent_models_lifecycle | 6 | 24 | 4 | 20 | 4 | 1.5 |
| 16 | provider_oauth_credentials | 6 | 0 | 1 | 8 | 4 | 1.5 |
| 17 | sandbox_policy_remote | 5 | 0 | 1 | 92 | 4 | 1.25 |
| 18 | code_intelligence | 4 | 0 | 1 | 6 | 4 | 1 |
| 19 | plugin_install_lifecycle | 3 | 0 | 3 | 24 | 4 | 0.75 |
| 20 | host_core_other | 2 | 4 | 1 | 149 | 4 | 0.5 |
| 21 | background_durable_jobs | 2 | 0 | 0 | 11 | 4 | 0.5 |
| 22 | subagent_delivery_ui | 2 | 2 | 2 | 10 | 8 | 0.25 |
| 23 | goal_plan_task | 2 | 0 | 0 | 15 | 8 | 0.25 |
| 24 | approval_review | 2 | 2 | 0 | 9 | 8 | 0.25 |
| 25 | agent_browser | 1 | 0 | 0 | 0 | 4 | 0.25 |
| 26 | usage_observability | 1 | 0 | 0 | 1 | 4 | 0.25 |
| 27 | skill_discovery_validation | 0 | 1 | 2 | 7 | — | 0 |
| 28 | provider_replay_history | 0 | 0 | 0 | 5 | — | 0 |
| 29 | compaction_cache | 0 | 0 | 0 | 4 | — | 0 |

## Cross-capability surface

Unlike the first product match, this table is many-to-many: one thread can count under Provider + OAuth + session + subagent, without duplicating the final unique-thread denominator.

| Shared capability | Threads | Solvable by us | Needs DSH seam | Core only |
|---|---:|---:|---:|---:|
| web_client | 295 | 47 | 19 | 229 |
| provider_transport | 278 | 147 | 10 | 121 |
| session_persistence | 194 | 29 | 15 | 150 |
| model_catalog | 174 | 97 | 6 | 71 |
| tui | 140 | 19 | 9 | 112 |
| file_tools | 123 | 22 | 4 | 97 |
| sandbox | 118 | 12 | 1 | 105 |
| protocol_normalization | 93 | 51 | 5 | 37 |
| subagent_sessions | 85 | 36 | 6 | 43 |
| commands_hooks | 84 | 27 | 8 | 49 |
| approval | 77 | 11 | 2 | 64 |
| multimodal | 72 | 39 | 2 | 31 |
| reasoning_compat | 67 | 40 | 0 | 27 |
| request_metadata | 64 | 20 | 5 | 39 |
| replay_history | 46 | 2 | 3 | 41 |
| skills_prompts | 46 | 15 | 3 | 28 |
| plugin_lifecycle | 46 | 4 | 8 | 34 |
| mcp | 42 | 13 | 7 | 22 |
| session_import | 40 | 6 | 3 | 31 |
| tool_stream_identity | 39 | 12 | 3 | 24 |
| oauth_credentials | 30 | 13 | 3 | 14 |
| background_jobs | 30 | 10 | 1 | 19 |
| remote_channels | 30 | 17 | 1 | 12 |
| memory | 23 | 16 | 2 | 5 |
| web_search | 23 | 12 | 0 | 11 |
| goal_plan | 22 | 6 | 1 | 15 |
| code_intelligence | 16 | 4 | 1 | 11 |
| user_questions | 15 | 5 | 2 | 8 |
| usage_observability | 14 | 3 | 2 | 9 |
| compaction | 7 | 0 | 2 | 5 |
| browser_automation | 3 | 2 | 0 | 1 |

## Exact actionable sets by engineering cluster

### provider_gateway_catalog

- **ready_now (27)**: [#208](https://github.com/deepseek-ai/deepseek-harness/discussions/208) · [#472](https://github.com/deepseek-ai/deepseek-harness/discussions/472) · [#473](https://github.com/deepseek-ai/deepseek-harness/discussions/473) · [#551](https://github.com/deepseek-ai/deepseek-harness/discussions/551) · [#611](https://github.com/deepseek-ai/deepseek-harness/discussions/611) · [#614](https://github.com/deepseek-ai/deepseek-harness/discussions/614) · [#636](https://github.com/deepseek-ai/deepseek-harness/discussions/636) · [#843](https://github.com/deepseek-ai/deepseek-harness/discussions/843) · [#990](https://github.com/deepseek-ai/deepseek-harness/discussions/990) · [#1208](https://github.com/deepseek-ai/deepseek-harness/discussions/1208) · [#1232](https://github.com/deepseek-ai/deepseek-harness/discussions/1232) · [#1272](https://github.com/deepseek-ai/deepseek-harness/discussions/1272) · [#1309](https://github.com/deepseek-ai/deepseek-harness/discussions/1309) · [#1498](https://github.com/deepseek-ai/deepseek-harness/discussions/1498) · [#1643](https://github.com/deepseek-ai/deepseek-harness/discussions/1643) · [#1705](https://github.com/deepseek-ai/deepseek-harness/discussions/1705) · [#2007](https://github.com/deepseek-ai/deepseek-harness/discussions/2007) · [#2023](https://github.com/deepseek-ai/deepseek-harness/discussions/2023) · [#2277](https://github.com/deepseek-ai/deepseek-harness/discussions/2277) · [#2489](https://github.com/deepseek-ai/deepseek-harness/discussions/2489) · [#2587](https://github.com/deepseek-ai/deepseek-harness/discussions/2587) · [#2637](https://github.com/deepseek-ai/deepseek-harness/discussions/2637) · [#2804](https://github.com/deepseek-ai/deepseek-harness/discussions/2804) · [#3004](https://github.com/deepseek-ai/deepseek-harness/discussions/3004) · [#3330](https://github.com/deepseek-ai/deepseek-harness/discussions/3330) · [#3397](https://github.com/deepseek-ai/deepseek-harness/discussions/3397) · [#3531](https://github.com/deepseek-ai/deepseek-harness/discussions/3531)
- **e2e_only (11)**: [#743](https://github.com/deepseek-ai/deepseek-harness/discussions/743) · [#947](https://github.com/deepseek-ai/deepseek-harness/discussions/947) · [#1080](https://github.com/deepseek-ai/deepseek-harness/discussions/1080) · [#1118](https://github.com/deepseek-ai/deepseek-harness/discussions/1118) · [#1148](https://github.com/deepseek-ai/deepseek-harness/discussions/1148) · [#2128](https://github.com/deepseek-ai/deepseek-harness/discussions/2128) · [#2170](https://github.com/deepseek-ai/deepseek-harness/discussions/2170) · [#3538](https://github.com/deepseek-ai/deepseek-harness/discussions/3538) · [#3745](https://github.com/deepseek-ai/deepseek-harness/discussions/3745) · [#3957](https://github.com/deepseek-ai/deepseek-harness/discussions/3957) · [#3958](https://github.com/deepseek-ai/deepseek-harness/discussions/3958)
- **pi2dsh_adapter_work (7)**: [#1063](https://github.com/deepseek-ai/deepseek-harness/discussions/1063) · [#1073](https://github.com/deepseek-ai/deepseek-harness/discussions/1073) · [#1099](https://github.com/deepseek-ai/deepseek-harness/discussions/1099) · [#1786](https://github.com/deepseek-ai/deepseek-harness/discussions/1786) · [#1866](https://github.com/deepseek-ai/deepseek-harness/discussions/1866) · [#2849](https://github.com/deepseek-ai/deepseek-harness/discussions/2849) · [#3816](https://github.com/deepseek-ai/deepseek-harness/discussions/3816)
- **pi_product_work (10)**: [#366](https://github.com/deepseek-ai/deepseek-harness/discussions/366) · [#762](https://github.com/deepseek-ai/deepseek-harness/discussions/762) · [#1604](https://github.com/deepseek-ai/deepseek-harness/discussions/1604) · [#1682](https://github.com/deepseek-ai/deepseek-harness/discussions/1682) · [#2354](https://github.com/deepseek-ai/deepseek-harness/discussions/2354) · [#2441](https://github.com/deepseek-ai/deepseek-harness/discussions/2441) · [#3283](https://github.com/deepseek-ai/deepseek-harness/discussions/3283) · [#3284](https://github.com/deepseek-ai/deepseek-harness/discussions/3284) · [#3335](https://github.com/deepseek-ai/deepseek-harness/discussions/3335) · [#3495](https://github.com/deepseek-ai/deepseek-harness/discussions/3495)
- **multi_product_composition (1)**: [#2884](https://github.com/deepseek-ai/deepseek-harness/discussions/2884)
- **dsh_public_seam_needed (5)**: [#280](https://github.com/deepseek-ai/deepseek-harness/discussions/280) · [#302](https://github.com/deepseek-ai/deepseek-harness/discussions/302) · [#836](https://github.com/deepseek-ai/deepseek-harness/discussions/836) · [#3314](https://github.com/deepseek-ai/deepseek-harness/discussions/3314) · [#3882](https://github.com/deepseek-ai/deepseek-harness/discussions/3882)

### provider_reasoning_compat

- **e2e_only (5)**: [#1146](https://github.com/deepseek-ai/deepseek-harness/discussions/1146) · [#1166](https://github.com/deepseek-ai/deepseek-harness/discussions/1166) · [#2659](https://github.com/deepseek-ai/deepseek-harness/discussions/2659) · [#2670](https://github.com/deepseek-ai/deepseek-harness/discussions/2670) · [#3493](https://github.com/deepseek-ai/deepseek-harness/discussions/3493)
- **pi2dsh_adapter_work (6)**: [#931](https://github.com/deepseek-ai/deepseek-harness/discussions/931) · [#1058](https://github.com/deepseek-ai/deepseek-harness/discussions/1058) · [#1198](https://github.com/deepseek-ai/deepseek-harness/discussions/1198) · [#2893](https://github.com/deepseek-ai/deepseek-harness/discussions/2893) · [#2894](https://github.com/deepseek-ai/deepseek-harness/discussions/2894) · [#3825](https://github.com/deepseek-ai/deepseek-harness/discussions/3825)
- **pi_product_work (1)**: [#196](https://github.com/deepseek-ai/deepseek-harness/discussions/196)

### provider_retry_errors

- **e2e_only (5)**: [#481](https://github.com/deepseek-ai/deepseek-harness/discussions/481) · [#3023](https://github.com/deepseek-ai/deepseek-harness/discussions/3023) · [#3338](https://github.com/deepseek-ai/deepseek-harness/discussions/3338) · [#3407](https://github.com/deepseek-ai/deepseek-harness/discussions/3407) · [#3949](https://github.com/deepseek-ai/deepseek-harness/discussions/3949)
- **pi2dsh_adapter_work (5)**: [#175](https://github.com/deepseek-ai/deepseek-harness/discussions/175) · [#1077](https://github.com/deepseek-ai/deepseek-harness/discussions/1077) · [#3112](https://github.com/deepseek-ai/deepseek-harness/discussions/3112) · [#3128](https://github.com/deepseek-ai/deepseek-harness/discussions/3128) · [#3157](https://github.com/deepseek-ai/deepseek-harness/discussions/3157)
- **pi_product_work (1)**: [#668](https://github.com/deepseek-ai/deepseek-harness/discussions/668)

### multimodal_admission_generation

- **ready_now (28)**: [#69](https://github.com/deepseek-ai/deepseek-harness/discussions/69) · [#245](https://github.com/deepseek-ai/deepseek-harness/discussions/245) · [#321](https://github.com/deepseek-ai/deepseek-harness/discussions/321) · [#356](https://github.com/deepseek-ai/deepseek-harness/discussions/356) · [#357](https://github.com/deepseek-ai/deepseek-harness/discussions/357) · [#427](https://github.com/deepseek-ai/deepseek-harness/discussions/427) · [#474](https://github.com/deepseek-ai/deepseek-harness/discussions/474) · [#588](https://github.com/deepseek-ai/deepseek-harness/discussions/588) · [#686](https://github.com/deepseek-ai/deepseek-harness/discussions/686) · [#784](https://github.com/deepseek-ai/deepseek-harness/discussions/784) · [#1029](https://github.com/deepseek-ai/deepseek-harness/discussions/1029) · [#1070](https://github.com/deepseek-ai/deepseek-harness/discussions/1070) · [#1264](https://github.com/deepseek-ai/deepseek-harness/discussions/1264) · [#1327](https://github.com/deepseek-ai/deepseek-harness/discussions/1327) · [#1354](https://github.com/deepseek-ai/deepseek-harness/discussions/1354) · [#1378](https://github.com/deepseek-ai/deepseek-harness/discussions/1378) · [#1434](https://github.com/deepseek-ai/deepseek-harness/discussions/1434) · [#1464](https://github.com/deepseek-ai/deepseek-harness/discussions/1464) · [#1487](https://github.com/deepseek-ai/deepseek-harness/discussions/1487) · [#1621](https://github.com/deepseek-ai/deepseek-harness/discussions/1621) · [#1882](https://github.com/deepseek-ai/deepseek-harness/discussions/1882) · [#1986](https://github.com/deepseek-ai/deepseek-harness/discussions/1986) · [#2005](https://github.com/deepseek-ai/deepseek-harness/discussions/2005) · [#2370](https://github.com/deepseek-ai/deepseek-harness/discussions/2370) · [#2782](https://github.com/deepseek-ai/deepseek-harness/discussions/2782) · [#2789](https://github.com/deepseek-ai/deepseek-harness/discussions/2789) · [#2892](https://github.com/deepseek-ai/deepseek-harness/discussions/2892) · [#3127](https://github.com/deepseek-ai/deepseek-harness/discussions/3127)
- **e2e_only (3)**: [#561](https://github.com/deepseek-ai/deepseek-harness/discussions/561) · [#1765](https://github.com/deepseek-ai/deepseek-harness/discussions/1765) · [#3930](https://github.com/deepseek-ai/deepseek-harness/discussions/3930)
- **pi2dsh_adapter_work (1)**: [#112](https://github.com/deepseek-ai/deepseek-harness/discussions/112)
- **pi_product_work (4)**: [#678](https://github.com/deepseek-ai/deepseek-harness/discussions/678) · [#1277](https://github.com/deepseek-ai/deepseek-harness/discussions/1277) · [#3512](https://github.com/deepseek-ai/deepseek-harness/discussions/3512) · [#3722](https://github.com/deepseek-ai/deepseek-harness/discussions/3722)
- **multi_product_composition (1)**: [#2622](https://github.com/deepseek-ai/deepseek-harness/discussions/2622)
- **dsh_public_seam_needed (2)**: [#893](https://github.com/deepseek-ai/deepseek-harness/discussions/893) · [#1612](https://github.com/deepseek-ai/deepseek-harness/discussions/1612)

### mcp_runtime

- **ready_now (2)**: [#2732](https://github.com/deepseek-ai/deepseek-harness/discussions/2732) · [#2815](https://github.com/deepseek-ai/deepseek-harness/discussions/2815)
- **e2e_only (2)**: [#597](https://github.com/deepseek-ai/deepseek-harness/discussions/597) · [#3991](https://github.com/deepseek-ai/deepseek-harness/discussions/3991)
- **pi2dsh_adapter_work (5)**: [#707](https://github.com/deepseek-ai/deepseek-harness/discussions/707) · [#1751](https://github.com/deepseek-ai/deepseek-harness/discussions/1751) · [#1754](https://github.com/deepseek-ai/deepseek-harness/discussions/1754) · [#2588](https://github.com/deepseek-ai/deepseek-harness/discussions/2588) · [#3821](https://github.com/deepseek-ai/deepseek-harness/discussions/3821)
- **multi_product_composition (1)**: [#2655](https://github.com/deepseek-ai/deepseek-harness/discussions/2655)
- **dsh_public_seam_needed (5)**: [#941](https://github.com/deepseek-ai/deepseek-harness/discussions/941) · [#1239](https://github.com/deepseek-ai/deepseek-harness/discussions/1239) · [#1300](https://github.com/deepseek-ai/deepseek-harness/discussions/1300) · [#3063](https://github.com/deepseek-ai/deepseek-harness/discussions/3063) · [#3439](https://github.com/deepseek-ai/deepseek-harness/discussions/3439)

### session_import_search

- **ready_now (1)**: [#383](https://github.com/deepseek-ai/deepseek-harness/discussions/383)
- **e2e_only (1)**: [#4169](https://github.com/deepseek-ai/deepseek-harness/discussions/4169)
- **pi2dsh_adapter_work (1)**: [#2434](https://github.com/deepseek-ai/deepseek-harness/discussions/2434)
- **pi_product_work (3)**: [#1273](https://github.com/deepseek-ai/deepseek-harness/discussions/1273) · [#1359](https://github.com/deepseek-ai/deepseek-harness/discussions/1359) · [#3121](https://github.com/deepseek-ai/deepseek-harness/discussions/3121)
- **multi_product_composition (1)**: [#75](https://github.com/deepseek-ai/deepseek-harness/discussions/75)
- **dsh_public_seam_needed (7)**: [#1429](https://github.com/deepseek-ai/deepseek-harness/discussions/1429) · [#1748](https://github.com/deepseek-ai/deepseek-harness/discussions/1748) · [#1896](https://github.com/deepseek-ai/deepseek-harness/discussions/1896) · [#2448](https://github.com/deepseek-ai/deepseek-harness/discussions/2448) · [#2582](https://github.com/deepseek-ai/deepseek-harness/discussions/2582) · [#2708](https://github.com/deepseek-ai/deepseek-harness/discussions/2708) · [#3105](https://github.com/deepseek-ai/deepseek-harness/discussions/3105)

### memory_learning

- **ready_now (5)**: [#192](https://github.com/deepseek-ai/deepseek-harness/discussions/192) · [#1345](https://github.com/deepseek-ai/deepseek-harness/discussions/1345) · [#1638](https://github.com/deepseek-ai/deepseek-harness/discussions/1638) · [#3668](https://github.com/deepseek-ai/deepseek-harness/discussions/3668) · [#3728](https://github.com/deepseek-ai/deepseek-harness/discussions/3728)
- **pi_product_work (11)**: [#14](https://github.com/deepseek-ai/deepseek-harness/discussions/14) · [#795](https://github.com/deepseek-ai/deepseek-harness/discussions/795) · [#1456](https://github.com/deepseek-ai/deepseek-harness/discussions/1456) · [#1787](https://github.com/deepseek-ai/deepseek-harness/discussions/1787) · [#1881](https://github.com/deepseek-ai/deepseek-harness/discussions/1881) · [#2736](https://github.com/deepseek-ai/deepseek-harness/discussions/2736) · [#2783](https://github.com/deepseek-ai/deepseek-harness/discussions/2783) · [#3202](https://github.com/deepseek-ai/deepseek-harness/discussions/3202) · [#3764](https://github.com/deepseek-ai/deepseek-harness/discussions/3764) · [#3898](https://github.com/deepseek-ai/deepseek-harness/discussions/3898) · [#3937](https://github.com/deepseek-ai/deepseek-harness/discussions/3937)
- **dsh_public_seam_needed (2)**: [#1822](https://github.com/deepseek-ai/deepseek-harness/discussions/1822) · [#3322](https://github.com/deepseek-ai/deepseek-harness/discussions/3322)

### ui_client_extension

- **ready_now (1)**: [#842](https://github.com/deepseek-ai/deepseek-harness/discussions/842)
- **pi2dsh_adapter_work (1)**: [#2713](https://github.com/deepseek-ai/deepseek-harness/discussions/2713)
- **pi_product_work (9)**: [#126](https://github.com/deepseek-ai/deepseek-harness/discussions/126) · [#309](https://github.com/deepseek-ai/deepseek-harness/discussions/309) · [#576](https://github.com/deepseek-ai/deepseek-harness/discussions/576) · [#1385](https://github.com/deepseek-ai/deepseek-harness/discussions/1385) · [#1753](https://github.com/deepseek-ai/deepseek-harness/discussions/1753) · [#1795](https://github.com/deepseek-ai/deepseek-harness/discussions/1795) · [#3287](https://github.com/deepseek-ai/deepseek-harness/discussions/3287) · [#3321](https://github.com/deepseek-ai/deepseek-harness/discussions/3321) · [#3511](https://github.com/deepseek-ai/deepseek-harness/discussions/3511)
- **dsh_public_seam_needed (18)**: [#604](https://github.com/deepseek-ai/deepseek-harness/discussions/604) · [#1065](https://github.com/deepseek-ai/deepseek-harness/discussions/1065) · [#1491](https://github.com/deepseek-ai/deepseek-harness/discussions/1491) · [#1535](https://github.com/deepseek-ai/deepseek-harness/discussions/1535) · [#1845](https://github.com/deepseek-ai/deepseek-harness/discussions/1845) · [#1914](https://github.com/deepseek-ai/deepseek-harness/discussions/1914) · [#2741](https://github.com/deepseek-ai/deepseek-harness/discussions/2741) · [#2799](https://github.com/deepseek-ai/deepseek-harness/discussions/2799) · [#2827](https://github.com/deepseek-ai/deepseek-harness/discussions/2827) · [#3114](https://github.com/deepseek-ai/deepseek-harness/discussions/3114) · [#3262](https://github.com/deepseek-ai/deepseek-harness/discussions/3262) · [#3298](https://github.com/deepseek-ai/deepseek-harness/discussions/3298) · [#3776](https://github.com/deepseek-ai/deepseek-harness/discussions/3776) · [#3785](https://github.com/deepseek-ai/deepseek-harness/discussions/3785) · [#3916](https://github.com/deepseek-ai/deepseek-harness/discussions/3916) · [#3981](https://github.com/deepseek-ai/deepseek-harness/discussions/3981) · [#4069](https://github.com/deepseek-ai/deepseek-harness/discussions/4069) · [#4070](https://github.com/deepseek-ai/deepseek-harness/discussions/4070)

### provider_request_metadata

- **e2e_only (6)**: [#2053](https://github.com/deepseek-ai/deepseek-harness/discussions/2053) · [#3362](https://github.com/deepseek-ai/deepseek-harness/discussions/3362) · [#3363](https://github.com/deepseek-ai/deepseek-harness/discussions/3363) · [#3372](https://github.com/deepseek-ai/deepseek-harness/discussions/3372) · [#3379](https://github.com/deepseek-ai/deepseek-harness/discussions/3379) · [#3394](https://github.com/deepseek-ai/deepseek-harness/discussions/3394)
- **pi2dsh_adapter_work (2)**: [#1078](https://github.com/deepseek-ai/deepseek-harness/discussions/1078) · [#2822](https://github.com/deepseek-ai/deepseek-harness/discussions/2822)
- **pi_product_work (2)**: [#2602](https://github.com/deepseek-ai/deepseek-harness/discussions/2602) · [#3169](https://github.com/deepseek-ai/deepseek-harness/discussions/3169)
- **dsh_public_seam_needed (2)**: [#2382](https://github.com/deepseek-ai/deepseek-harness/discussions/2382) · [#2383](https://github.com/deepseek-ai/deepseek-harness/discussions/2383)

### provider_tool_stream

- **e2e_only (8)**: [#1149](https://github.com/deepseek-ai/deepseek-harness/discussions/1149) · [#2820](https://github.com/deepseek-ai/deepseek-harness/discussions/2820) · [#2823](https://github.com/deepseek-ai/deepseek-harness/discussions/2823) · [#2855](https://github.com/deepseek-ai/deepseek-harness/discussions/2855) · [#2859](https://github.com/deepseek-ai/deepseek-harness/discussions/2859) · [#3342](https://github.com/deepseek-ai/deepseek-harness/discussions/3342) · [#3374](https://github.com/deepseek-ai/deepseek-harness/discussions/3374) · [#3384](https://github.com/deepseek-ai/deepseek-harness/discussions/3384)
- **pi2dsh_adapter_work (2)**: [#1113](https://github.com/deepseek-ai/deepseek-harness/discussions/1113) · [#3090](https://github.com/deepseek-ai/deepseek-harness/discussions/3090)
- **dsh_public_seam_needed (1)**: [#1895](https://github.com/deepseek-ai/deepseek-harness/discussions/1895)

### web_search_browser

- **ready_now (5)**: [#779](https://github.com/deepseek-ai/deepseek-harness/discussions/779) · [#940](https://github.com/deepseek-ai/deepseek-harness/discussions/940) · [#1145](https://github.com/deepseek-ai/deepseek-harness/discussions/1145) · [#1717](https://github.com/deepseek-ai/deepseek-harness/discussions/1717) · [#3961](https://github.com/deepseek-ai/deepseek-harness/discussions/3961)
- **e2e_only (1)**: [#323](https://github.com/deepseek-ai/deepseek-harness/discussions/323)
- **pi2dsh_adapter_work (1)**: [#2453](https://github.com/deepseek-ai/deepseek-harness/discussions/2453)
- **pi_product_work (3)**: [#934](https://github.com/deepseek-ai/deepseek-harness/discussions/934) · [#2353](https://github.com/deepseek-ai/deepseek-harness/discussions/2353) · [#2601](https://github.com/deepseek-ai/deepseek-harness/discussions/2601)

### file_context_diff

- **pi2dsh_adapter_work (1)**: [#336](https://github.com/deepseek-ai/deepseek-harness/discussions/336)
- **pi_product_work (3)**: [#995](https://github.com/deepseek-ai/deepseek-harness/discussions/995) · [#1791](https://github.com/deepseek-ai/deepseek-harness/discussions/1791) · [#2704](https://github.com/deepseek-ai/deepseek-harness/discussions/2704)

### skills_config_migration

- **ready_now (2)**: [#803](https://github.com/deepseek-ai/deepseek-harness/discussions/803) · [#1711](https://github.com/deepseek-ai/deepseek-harness/discussions/1711)
- **e2e_only (1)**: [#3744](https://github.com/deepseek-ai/deepseek-harness/discussions/3744)
- **pi2dsh_adapter_work (2)**: [#88](https://github.com/deepseek-ai/deepseek-harness/discussions/88) · [#3980](https://github.com/deepseek-ai/deepseek-harness/discussions/3980)
- **pi_product_work (4)**: [#372](https://github.com/deepseek-ai/deepseek-harness/discussions/372) · [#838](https://github.com/deepseek-ai/deepseek-harness/discussions/838) · [#1159](https://github.com/deepseek-ai/deepseek-harness/discussions/1159) · [#3497](https://github.com/deepseek-ai/deepseek-harness/discussions/3497)

### remote_im_voice

- **ready_now (4)**: [#2545](https://github.com/deepseek-ai/deepseek-harness/discussions/2545) · [#2881](https://github.com/deepseek-ai/deepseek-harness/discussions/2881) · [#2882](https://github.com/deepseek-ai/deepseek-harness/discussions/2882) · [#2883](https://github.com/deepseek-ai/deepseek-harness/discussions/2883)
- **pi_product_work (2)**: [#342](https://github.com/deepseek-ai/deepseek-harness/discussions/342) · [#1243](https://github.com/deepseek-ai/deepseek-harness/discussions/1243)
- **multi_product_composition (5)**: [#266](https://github.com/deepseek-ai/deepseek-harness/discussions/266) · [#1301](https://github.com/deepseek-ai/deepseek-harness/discussions/1301) · [#1302](https://github.com/deepseek-ai/deepseek-harness/discussions/1302) · [#1732](https://github.com/deepseek-ai/deepseek-harness/discussions/1732) · [#3348](https://github.com/deepseek-ai/deepseek-harness/discussions/3348)
- **dsh_public_seam_needed (1)**: [#2431](https://github.com/deepseek-ai/deepseek-harness/discussions/2431)

### subagent_models_lifecycle

- **ready_now (24)**: [#455](https://github.com/deepseek-ai/deepseek-harness/discussions/455) · [#1056](https://github.com/deepseek-ai/deepseek-harness/discussions/1056) · [#1100](https://github.com/deepseek-ai/deepseek-harness/discussions/1100) · [#1105](https://github.com/deepseek-ai/deepseek-harness/discussions/1105) · [#1136](https://github.com/deepseek-ai/deepseek-harness/discussions/1136) · [#1190](https://github.com/deepseek-ai/deepseek-harness/discussions/1190) · [#1312](https://github.com/deepseek-ai/deepseek-harness/discussions/1312) · [#1358](https://github.com/deepseek-ai/deepseek-harness/discussions/1358) · [#1369](https://github.com/deepseek-ai/deepseek-harness/discussions/1369) · [#1472](https://github.com/deepseek-ai/deepseek-harness/discussions/1472) · [#1725](https://github.com/deepseek-ai/deepseek-harness/discussions/1725) · [#2006](https://github.com/deepseek-ai/deepseek-harness/discussions/2006) · [#2672](https://github.com/deepseek-ai/deepseek-harness/discussions/2672) · [#2904](https://github.com/deepseek-ai/deepseek-harness/discussions/2904) · [#2970](https://github.com/deepseek-ai/deepseek-harness/discussions/2970) · [#3008](https://github.com/deepseek-ai/deepseek-harness/discussions/3008) · [#3377](https://github.com/deepseek-ai/deepseek-harness/discussions/3377) · [#3552](https://github.com/deepseek-ai/deepseek-harness/discussions/3552) · [#3741](https://github.com/deepseek-ai/deepseek-harness/discussions/3741) · [#3878](https://github.com/deepseek-ai/deepseek-harness/discussions/3878) · [#4065](https://github.com/deepseek-ai/deepseek-harness/discussions/4065) · [#4077](https://github.com/deepseek-ai/deepseek-harness/discussions/4077) · [#4158](https://github.com/deepseek-ai/deepseek-harness/discussions/4158) · [#4174](https://github.com/deepseek-ai/deepseek-harness/discussions/4174)
- **e2e_only (1)**: [#2690](https://github.com/deepseek-ai/deepseek-harness/discussions/2690)
- **pi_product_work (4)**: [#109](https://github.com/deepseek-ai/deepseek-harness/discussions/109) · [#703](https://github.com/deepseek-ai/deepseek-harness/discussions/703) · [#1172](https://github.com/deepseek-ai/deepseek-harness/discussions/1172) · [#1745](https://github.com/deepseek-ai/deepseek-harness/discussions/1745)
- **multi_product_composition (1)**: [#993](https://github.com/deepseek-ai/deepseek-harness/discussions/993)
- **dsh_public_seam_needed (4)**: [#2407](https://github.com/deepseek-ai/deepseek-harness/discussions/2407) · [#2639](https://github.com/deepseek-ai/deepseek-harness/discussions/2639) · [#3103](https://github.com/deepseek-ai/deepseek-harness/discussions/3103) · [#3796](https://github.com/deepseek-ai/deepseek-harness/discussions/3796)

### provider_oauth_credentials

- **e2e_only (2)**: [#695](https://github.com/deepseek-ai/deepseek-harness/discussions/695) · [#3387](https://github.com/deepseek-ai/deepseek-harness/discussions/3387)
- **pi2dsh_adapter_work (3)**: [#2668](https://github.com/deepseek-ai/deepseek-harness/discussions/2668) · [#3813](https://github.com/deepseek-ai/deepseek-harness/discussions/3813) · [#4190](https://github.com/deepseek-ai/deepseek-harness/discussions/4190)
- **pi_product_work (1)**: [#3917](https://github.com/deepseek-ai/deepseek-harness/discussions/3917)
- **dsh_public_seam_needed (1)**: [#3997](https://github.com/deepseek-ai/deepseek-harness/discussions/3997)

### sandbox_policy_remote

- **pi_product_work (5)**: [#76](https://github.com/deepseek-ai/deepseek-harness/discussions/76) · [#90](https://github.com/deepseek-ai/deepseek-harness/discussions/90) · [#782](https://github.com/deepseek-ai/deepseek-harness/discussions/782) · [#794](https://github.com/deepseek-ai/deepseek-harness/discussions/794) · [#4191](https://github.com/deepseek-ai/deepseek-harness/discussions/4191)
- **dsh_public_seam_needed (1)**: [#2234](https://github.com/deepseek-ai/deepseek-harness/discussions/2234)

### code_intelligence

- **pi_product_work (4)**: [#261](https://github.com/deepseek-ai/deepseek-harness/discussions/261) · [#1165](https://github.com/deepseek-ai/deepseek-harness/discussions/1165) · [#1167](https://github.com/deepseek-ai/deepseek-harness/discussions/1167) · [#1864](https://github.com/deepseek-ai/deepseek-harness/discussions/1864)
- **dsh_public_seam_needed (1)**: [#781](https://github.com/deepseek-ai/deepseek-harness/discussions/781)

### plugin_install_lifecycle

- **e2e_only (1)**: [#651](https://github.com/deepseek-ai/deepseek-harness/discussions/651)
- **pi2dsh_adapter_work (2)**: [#68](https://github.com/deepseek-ai/deepseek-harness/discussions/68) · [#1629](https://github.com/deepseek-ai/deepseek-harness/discussions/1629)
- **dsh_public_seam_needed (3)**: [#306](https://github.com/deepseek-ai/deepseek-harness/discussions/306) · [#802](https://github.com/deepseek-ai/deepseek-harness/discussions/802) · [#2698](https://github.com/deepseek-ai/deepseek-harness/discussions/2698)

### host_core_other

- **ready_now (4)**: [#102](https://github.com/deepseek-ai/deepseek-harness/discussions/102) · [#303](https://github.com/deepseek-ai/deepseek-harness/discussions/303) · [#364](https://github.com/deepseek-ai/deepseek-harness/discussions/364) · [#2261](https://github.com/deepseek-ai/deepseek-harness/discussions/2261)
- **e2e_only (1)**: [#965](https://github.com/deepseek-ai/deepseek-harness/discussions/965)
- **multi_product_composition (1)**: [#1028](https://github.com/deepseek-ai/deepseek-harness/discussions/1028)
- **dsh_public_seam_needed (1)**: [#3061](https://github.com/deepseek-ai/deepseek-harness/discussions/3061)

### background_durable_jobs

- **e2e_only (1)**: [#1517](https://github.com/deepseek-ai/deepseek-harness/discussions/1517)
- **pi_product_work (1)**: [#971](https://github.com/deepseek-ai/deepseek-harness/discussions/971)

### subagent_delivery_ui

- **ready_now (2)**: [#45](https://github.com/deepseek-ai/deepseek-harness/discussions/45) · [#48](https://github.com/deepseek-ai/deepseek-harness/discussions/48)
- **e2e_only (2)**: [#2145](https://github.com/deepseek-ai/deepseek-harness/discussions/2145) · [#2682](https://github.com/deepseek-ai/deepseek-harness/discussions/2682)
- **dsh_public_seam_needed (2)**: [#1493](https://github.com/deepseek-ai/deepseek-harness/discussions/1493) · [#3104](https://github.com/deepseek-ai/deepseek-harness/discussions/3104)

### goal_plan_task

- **pi_product_work (2)**: [#365](https://github.com/deepseek-ai/deepseek-harness/discussions/365) · [#1311](https://github.com/deepseek-ai/deepseek-harness/discussions/1311)

### approval_review

- **ready_now (2)**: [#421](https://github.com/deepseek-ai/deepseek-harness/discussions/421) · [#2692](https://github.com/deepseek-ai/deepseek-harness/discussions/2692)
- **pi_product_work (2)**: [#331](https://github.com/deepseek-ai/deepseek-harness/discussions/331) · [#1743](https://github.com/deepseek-ai/deepseek-harness/discussions/1743)

### agent_browser

- **pi_product_work (1)**: [#922](https://github.com/deepseek-ai/deepseek-harness/discussions/922)

### usage_observability

- **pi_product_work (1)**: [#1742](https://github.com/deepseek-ai/deepseek-harness/discussions/1742)

### skill_discovery_validation

- **ready_now (1)**: [#3625](https://github.com/deepseek-ai/deepseek-harness/discussions/3625)
- **dsh_public_seam_needed (2)**: [#1427](https://github.com/deepseek-ai/deepseek-harness/discussions/1427) · [#2190](https://github.com/deepseek-ai/deepseek-harness/discussions/2190)

## Manual/low-confidence review ledger

Final manual overrides: 15. Final confidence < 0.7: 0.

- [#75](https://github.com/deepseek-ai/deepseek-harness/discussions/75) — multi_product_composition / session_import_search / confidence 0.95: 组合 pi2dsh 的 DSH 持久会话只读投影与 remote-pi 类远程客户端：远程列出会话、按会话打开历史并继续当前会话。只读浏览不需要原生会话写入，也不能用网页搜索包代替。
- [#126](https://github.com/deepseek-ai/deepseek-harness/discussions/126) — pi_product_work / ui_client_extension / confidence 0.96: TUI 已存在；Vim/Neovim 集成仍需独立客户端插件，把编辑器命令、会话选择和消息流接到 DSH。
- [#218](https://github.com/deepseek-ai/deepseek-harness/discussions/218) — dsh_core_only / memory_learning / confidence 0.98: 可以在回帖中提供 pi-hermes-memory 的当前替代方案，但对原帖的官方 roadmap 问题没有可交付替代。
- [#309](https://github.com/deepseek-ai/deepseek-harness/discussions/309) — pi_product_work / ui_client_extension / confidence 0.97: CLI/TUI 部分已存在；VSCode 插件仍需独立客户端产品实现会话、流式消息和文件跳转。
- [#372](https://github.com/deepseek-ai/deepseek-harness/discussions/372) — pi_product_work / skills_config_migration / confidence 0.9: 提供语言/风格系统提示插件，约束中文标点和免责声明风格；它改善用户结果但不保证改变模型内生行为。
- [#481](https://github.com/deepseek-ai/deepseek-harness/discussions/481) — e2e_only / provider_retry_errors / confidence 0.9: 用同一 DeepSeek 端点走 provider-owned route 复现流失败并对照官方适配器。
- [#603](https://github.com/deepseek-ai/deepseek-harness/discussions/603) — dsh_core_only / host_core_other / confidence 0.9: 信息不足，无法证明任何 Pi 替代能满足删除语义。
- [#668](https://github.com/deepseek-ai/deepseek-harness/discussions/668) — pi_product_work / provider_retry_errors / confidence 0.95: 由 transport-owning Provider 实现可配置、有界、按错误类别的重试策略。
- [#695](https://github.com/deepseek-ai/deepseek-harness/discussions/695) — e2e_only / provider_oauth_credentials / confidence 0.9: 用 Pi Provider/凭证路线绕过设置页配置失败，但需识别截图中的实际服务。
- [#743](https://github.com/deepseek-ai/deepseek-harness/discussions/743) — e2e_only / provider_gateway_catalog / confidence 0.94: 为 gpt-daybreak-blue 与 kimi-k3 选择或实现 transport-owning Pi Provider。
- [#1080](https://github.com/deepseek-ai/deepseek-harness/discussions/1080) — e2e_only / provider_gateway_catalog / confidence 0.94: 使用 opencode-zen 对应的 Pi provider route；需用真实账号验证端点、凭证和模型目录。
- [#2128](https://github.com/deepseek-ai/deepseek-harness/discussions/2128) — e2e_only / provider_gateway_catalog / confidence 0.95: 使用 Zen 的正确 provider/endpoint 走 Pi transport，但必须以真实账号闭环。
- [#3342](https://github.com/deepseek-ai/deepseek-harness/discussions/3342) — e2e_only / provider_tool_stream / confidence 0.95: 用 agnes 专属或兼容 Pi transport 接管工具 schema 与流式工具调用。
- [#3362](https://github.com/deepseek-ai/deepseek-harness/discussions/3362) — e2e_only / provider_request_metadata / confidence 0.94: 走显式外源 Pi route 并从每个 request/header 与 usage 证明实际计费路由。
- [#3679](https://github.com/deepseek-ai/deepseek-harness/discussions/3679) — dsh_core_only / sandbox_policy_remote / confidence 0.99: 内容只有 diagnostic，不能定义可交付结果。
- [#3722](https://github.com/deepseek-ai/deepseek-harness/discussions/3722) — pi_product_work / multimodal_admission_generation / confidence 0.94: 提供 PDF 文本优先解析、按页图像回退和批量视觉摘要工具，避免整 PDF 交给通用模型慢处理。
- [#3980](https://github.com/deepseek-ai/deepseek-harness/discussions/3980) — pi2dsh_adapter_work / skills_config_migration / confidence 0.99: 增加本地传统/Claude/Codex Skill 目录导入与校验，把 SKILL.md 变成 Pi 可声明资源并进入 DSH 调用面。

## Artifacts

- `architecture-feasibility-final.json` — final per-thread verdicts and provenance
- `architecture-feasibility.json` — first architecture pass
- `architecture-feasibility-challenges.json` — adversarial second pass
- `architecture-feasibility-recoveries.json` — alternate-path recovery for core-only items
- `architecture-feasibility-*-overrides.json` — explicit human/evidence corrections
- `audit-feasibility.mjs`, `challenge-feasibility.mjs`, `recover-alternates.mjs`, `finalize-feasibility.mjs` — reproducible pipeline
