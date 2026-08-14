import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectPiMcpServers, convertPiMcpConfig, renderMcpPatch } from '../src/mcp-config.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function scratchProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pi2dsh-mcp-'))
  cleanup.push(root)
  return root
}

describe('Pi MCP configuration -> DSH mcp-client translation', () => {
  it('reads project layers, honors precedence, and translates stdio and http servers', async () => {
    const root = await scratchProject()
    await writeFile(join(root, '.mcp.json'), JSON.stringify({
      mcpServers: {
        github: { command: 'npx', args: ['-y', 'server-github'], env: { GITHUB_TOKEN: '$GITHUB_TOKEN' } },
        web: { url: 'http://localhost:3000/mcp', headers: { Authorization: '${MCP_AUTH}' } },
        legacy: { command: 'legacy-server' },
      },
    }))
    await mkdir(join(root, '.pi'))
    // The .pi project override is the highest-precedence layer: a bare
    // disabled toggle updates the effective lower-layer server.
    await writeFile(join(root, '.pi', 'mcp.json'), JSON.stringify({
      mcpServers: { legacy: { disabled: true } },
    }))

    const { servers } = collectPiMcpServers(root)
    expect(servers.get('legacy')?.disabled).toBe(true)
    expect(servers.get('github')?.transport).toBe('stdio')
    expect(servers.get('web')?.transport).toBe('streamable-http')

    const result = convertPiMcpConfig(root)
    expect(result.entries.map(entry => entry.id)).toEqual(['mcp-github', 'mcp-web'])
    expect(result.warnings).toContainEqual(expect.objectContaining({ server: 'legacy' }))
    const github = result.entries[0]!.config as Record<string, unknown>
    expect(github).toMatchObject({ serverName: 'github', transport: 'stdio', command: 'npx' })
    // $VAR references become !!js process.env expressions so the patch stays
    // credential-free.
    expect((github.env as Record<string, unknown>).GITHUB_TOKEN).toEqual({ __pi2dshJs: 'process.env.GITHUB_TOKEN' })
    const rendered = renderMcpPatch(result)
    expect(rendered).toContain("name: '@deepseek-ai/dsh-mcp-client'")
    expect(rendered).toContain('GITHUB_TOKEN: !!js process.env.GITHUB_TOKEN')
    expect(rendered).toContain('Authorization: !!js process.env.MCP_AUTH')
    expect(rendered).not.toContain('legacy')
  })

  it('warns on literal secrets and rejects DSH-invalid server names', async () => {
    const root = await scratchProject()
    await writeFile(join(root, '.mcp.json'), JSON.stringify({
      mcpServers: {
        leaky: { command: 'x', env: { API_KEY: 'sk-plaintext' } },
        'bad name!': { command: 'y' },
      },
    }))
    const result = convertPiMcpConfig(root)
    expect(result.warnings).toContainEqual(expect.objectContaining({
      server: 'leaky',
      message: expect.stringContaining('environment variable'),
    }))
    expect(result.warnings).toContainEqual(expect.objectContaining({
      server: 'bad name!',
      message: expect.stringContaining('serverName'),
    }))
    expect(result.entries.map(entry => entry.id)).toEqual(['mcp-leaky'])
  })

  it('reports an empty conversion honestly', async () => {
    const root = await scratchProject()
    const result = convertPiMcpConfig(root)
    expect(result.entries).toEqual([])
    expect(renderMcpPatch(result)).toContain('no enabled MCP servers')
  })
})
