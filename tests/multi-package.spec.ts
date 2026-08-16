// Two Pi packages in one profile. The engine has always mounted a list, but
// every package registered its tool-guidance prompt section under one constant
// name, so DSH's duplicate-name rejection took the SECOND package's whole mount
// down with it — silently, because the failure was logged where a profile's
// logger level could hide it. A user with two plugins installed had one.
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import SessionStore from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { manifestForInstalled } from '../src/host.js'
import { applyPiPackage } from '../src/runtime.js'
import { resolvePiPackage } from '../src/source.js'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

/** Stage one minimal Pi package that registers a single named tool. */
async function stagePackage(scratch: string, name: string): Promise<string> {
  const dir = join(scratch, name)
  await cp(join(projectRoot, 'fixtures/complete-package'), dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name, version: '0.0.0', type: 'module', pi: { extensions: ['solo.mjs'] },
  }))
  await writeFile(join(dir, 'solo.mjs'), [
    'export default function (pi) {',
    `  pi.registerTool({ name: ${JSON.stringify(`${name.replaceAll('-', '_')}_tool`)},`,
    "    description: 'probe', parameters: { type: 'object', properties: {} },",
    "    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }) })",
    '}',
    '',
  ].join('\n'))
  return dir
}

describe('more than one Pi package in a profile', () => {
  it('mounts every package, not just the first', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'pi2dsh-multi-'))
    cleanup.push(scratch)
    const dirs = [await stagePackage(scratch, 'pi-alpha-probe'), await stagePackage(scratch, 'pi-beta-probe')]

    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(AgentRegistry)

    for (const dir of dirs) {
      const pkg = await resolvePiPackage(dir)
      let manifest
      try {
        manifest = await manifestForInstalled(pkg)
      } finally {
        await pkg.dispose()
      }
      const plugin: Plugin.Object = {
        name: `pi2dsh:${dir}`,
        inject: ['tools', 'systemPrompt', 'commands', 'skills'],
        async apply(scope) {
          await applyPiPackage(scope, { rootUrl: pathToFileURL(`${dir}/`), manifest })
        },
      }
      // The second mount must not throw — that is the regression.
      await ctx.plugin(plugin)
    }

    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.tools.map(tool => tool.name)).toEqual(
      expect.arrayContaining(['pi_alpha_probe_tool', 'pi_beta_probe_tool']),
    )
  })
})
