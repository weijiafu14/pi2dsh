// The contract-test graph must exercise exactly the declared host generation.
// Updating direct devDependencies alone leaves auto-installed peers at an old
// lockfile version, producing a green test run against a mixed host.
import assert from 'node:assert/strict'
import {existsSync, readFileSync, realpathSync} from 'node:fs'
import {createRequire} from 'node:module'
import {join, resolve} from 'node:path'

const root=resolve(new URL('..',import.meta.url).pathname)
const manifestPath=join(root,'package.json')
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'))
const expected=manifest.devDependencies['@deepseek-ai/dsh-agent']
const pending=[manifestPath],seen=new Set(),versions=new Map()
while(pending.length){
  const path=realpathSync(pending.pop())
  if(seen.has(path))continue
  seen.add(path)
  const pkg=JSON.parse(readFileSync(path,'utf8'))
  if(pkg.name.startsWith('@deepseek-ai/dsh')){
    assert.equal(pkg.version,expected,`${pkg.name} resolves ${pkg.version}, expected ${expected}: ${path}`)
    versions.set(pkg.name,pkg.version)
  }
  const req=createRequire(path)
  const dependencies={...pkg.dependencies,...pkg.peerDependencies,...(path===manifestPath?pkg.devDependencies:{})}
  for(const name of Object.keys(dependencies).filter(name=>name.startsWith('@deepseek-ai/')||name==='@xmoon76/dsh-pi-tui')){
    const found=(req.resolve.paths(name)??[]).map(base=>join(base,name,'package.json')).find(existsSync)
    if(!found){
      assert(!pkg.dependencies?.[name] && !(path===manifestPath&&pkg.devDependencies?.[name]),`missing dependency ${name} from ${pkg.name}`)
      continue
    }
    pending.push(found)
  }
}
for(const [name,range] of Object.entries(manifest.peerDependencies)){
  if(name.startsWith('@deepseek-ai/dsh'))assert.equal(range,expected,`${name} must declare the tested host`)
}
console.log(`Host graph verified: ${versions.size} DSH packages, all ${expected}`)
