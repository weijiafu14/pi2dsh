// Stage a dsh-work-x tarball whose pi2dsh dependency points at the engine
// under test. ONE authority for this recipe — verify-examples-e2e and the
// codex-image scenario both install the suite this way, and a hand-copied
// second version is how the two would drift.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

/**
 * @param projectRoot - the pi2dsh repository root (holds dsh-x/).
 * @param engineSpec - engine install spec (`file:…` or `pi2dsh@<version>`).
 * @param scratch - scenario scratch dir; the tarball lands here.
 * @param env - process env for npm pack.
 * @returns absolute path to the staged tarball.
 */
export async function stageSuiteTarball(projectRoot, engineSpec, scratch, env) {
  const suiteDir = join(scratch, 'dsh-x')
  await mkdir(suiteDir, { recursive: true })
  const manifest = JSON.parse(await readFile(join(projectRoot, 'dsh-x/package.json'), 'utf8'))
  // A dependency value is a version/range/file: URL — never "name@version"
  // (that spelling is only valid on an install command line).
  manifest.dependencies.pi2dsh = engineSpec.startsWith('pi2dsh@') ? engineSpec.slice('pi2dsh@'.length) : engineSpec
  await writeFile(join(suiteDir, 'package.json'), JSON.stringify(manifest, null, 2))
  await writeFile(join(suiteDir, 'cordis.patch.yml'), await readFile(join(projectRoot, 'dsh-x/cordis.patch.yml'), 'utf8'))
  await writeFile(join(suiteDir, 'index.mjs'), await readFile(join(projectRoot, 'dsh-x/index.mjs'), 'utf8'))
  // The suite's browser half — its prepack guard refuses to pack without it
  // (a user would get a suite whose product UI silently never loads).
  await writeFile(join(suiteDir, 'client.js'), await readFile(join(projectRoot, 'dsh-x/client.js'), 'utf8'))
  await writeFile(join(suiteDir, 'README.md'), await readFile(join(projectRoot, 'dsh-x/README.md'), 'utf8'))
  const packOut = await execFile('npm', ['pack', '--json', '--pack-destination', scratch], { cwd: suiteDir, env, timeout: 120_000 })
  return join(scratch, JSON.parse(packOut.stdout)[0].filename)
}
