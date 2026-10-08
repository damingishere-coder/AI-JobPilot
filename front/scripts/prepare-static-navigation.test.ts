// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { prepareStaticNavigation } from './prepare-static-navigation.mjs'

const temporaryRoots: string[] = []
function fixture(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jobpilot-static-navigation-'))
  temporaryRoots.push(root)
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return root
}
afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const resolved = path.resolve(root)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('jobpilot-static-navigation-')) throw new Error('Unexpected fixture cleanup path')
    fs.rmSync(resolved, { recursive: true, force: true })
  }
})

it('serves exported page payloads at the URLs requested by the client without removing their original files', () => {
  const root = fixture({ 'hr/__next.hr/__PAGE__.txt': 'hr-payload', 'boss/analysis/__next.boss/analysis/__PAGE__.txt': 'analysis-payload' })
  expect(prepareStaticNavigation(root)).toBe(2)
  expect(fs.readFileSync(path.join(root, 'hr/__next.hr.__PAGE__.txt'), 'utf8')).toBe('hr-payload')
  expect(fs.readFileSync(path.join(root, 'boss/analysis/__next.boss.analysis.__PAGE__.txt'), 'utf8')).toBe('analysis-payload')
  expect(fs.readFileSync(path.join(root, 'hr/__next.hr/__PAGE__.txt'), 'utf8')).toBe('hr-payload')
})
it('leaves regular HTML, scripts and already flat navigation resources unchanged', () => {
  const files = { 'index.html': '<html>fixture</html>', '_next/static/example.js': 'fixture-script', '__next.__PAGE__.txt': 'root-payload', 'hr/__next._tree.txt': 'tree-payload' }
  const root = fixture(files)
  expect(prepareStaticNavigation(root)).toBe(0)
  for (const [name, content] of Object.entries(files)) expect(fs.readFileSync(path.join(root, name), 'utf8')).toBe(content)
})
it('can prepare the same export again without accumulating files or changing payload bytes', () => {
  const root = fixture({ 'hr/__next.hr/__PAGE__.txt': 'unchanged-payload' })
  prepareStaticNavigation(root)
  const before = fs.readdirSync(path.join(root, 'hr'))
  expect(prepareStaticNavigation(root)).toBe(1)
  expect(fs.readdirSync(path.join(root, 'hr'))).toEqual(before)
  expect(fs.readFileSync(path.join(root, 'hr/__next.hr.__PAGE__.txt'), 'utf8')).toBe('unchanged-payload')
})
it('fails rather than overwriting a different existing navigation payload', () => {
  const root = fixture({ 'hr/__next.hr/__PAGE__.txt': 'new-payload', 'hr/__next.hr.__PAGE__.txt': 'different-payload' })
  expect(() => prepareStaticNavigation(root)).toThrow('payload collision')
  expect(fs.readFileSync(path.join(root, 'hr/__next.hr.__PAGE__.txt'), 'utf8')).toBe('different-payload')
})
