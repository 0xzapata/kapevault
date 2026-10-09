// Writes <outDir>/version.json = {"commit", "builtAt"} so "what is live?" has a factual answer.
// Wire as "postbuild": "node scripts/write-version.mjs"  (outDir defaults to dist).
//
// builtAt is the commit's time (or SOURCE_DATE_EPOCH, seconds, when the build sets it), not the
// clock: this file ships inside the asar, and two builds of one commit must be byte-identical
// for anyone to rebuild a release and compare.
import { execSync } from 'node:child_process'
import { writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'dist'
if (!existsSync(outDir)) {
  console.error(`write-version: ${outDir}/ does not exist - run it after the build`)
  process.exit(1)
}
const commit = execSync('git rev-parse HEAD').toString().trim()
const epoch = process.env.SOURCE_DATE_EPOCH
const time = epoch ? new Date(Number(epoch) * 1000) : new Date(execSync('git log -1 --format=%cI').toString().trim())
if (Number.isNaN(time.getTime())) {
  console.error(`write-version: no usable build time (SOURCE_DATE_EPOCH=${epoch ?? 'unset'})`)
  process.exit(1)
}
writeFileSync(join(outDir, 'version.json'), JSON.stringify({ commit, builtAt: time.toISOString() }) + '\n')
console.log(`write-version: ${outDir}/version.json -> ${commit.slice(0, 7)}`)
