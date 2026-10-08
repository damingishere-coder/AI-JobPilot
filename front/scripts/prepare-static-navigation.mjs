import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** @param {string} exportDirectory */
export function prepareStaticNavigation(exportDirectory) {
  const root = path.resolve(exportDirectory)
  let aliases = 0
  /** @param {string} directory */
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const source = path.join(directory, entry.name)
      if (entry.isDirectory()) { visit(source); continue }
      if (!entry.isFile() || !entry.name.endsWith('.txt')) continue
      const parts = path.relative(root, source).split(path.sep)
      const segment = parts.findIndex(part => part.startsWith('__next.'))
      if (segment < 0 || segment === parts.length - 1) continue
      // The client requests dotted segment URLs; export stores the same payload in nested folders.
      // Preserve that output and add byte-identical files so the existing static server can serve both.
      const target = path.join(root, ...parts.slice(0, segment), parts.slice(segment).join('.'))
      if (fs.existsSync(target) && !fs.readFileSync(target).equals(fs.readFileSync(source))) {
        throw new Error(`Static navigation payload collision: ${path.relative(root, target)}`)
      }
      if (!fs.existsSync(target)) fs.copyFileSync(source, target)
      aliases++
    }
  }
  visit(root)
  return aliases
}

const script = fileURLToPath(import.meta.url)
if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  const count = prepareStaticNavigation(path.join(path.dirname(script), '..', 'out'))
  console.log(`Static navigation payloads prepared: ${count}`)
}
