import { describe, it, expect } from 'vitest'
import { detectLangFromPath } from '~/composables/chat/markdown/detect-lang'

describe('detectLangFromPath', () => {
  it('maps .ts to ts', () => expect(detectLangFromPath('src/a.ts')).toBe('ts'))
  it('maps .tsx to tsx', () => expect(detectLangFromPath('app/Foo.tsx')).toBe('tsx'))
  it('maps .vue to vue', () => expect(detectLangFromPath('app/X.vue')).toBe('vue'))
  it('maps .py to python', () => expect(detectLangFromPath('x/y.py')).toBe('python'))
  it('maps .json to json', () => expect(detectLangFromPath('pkg.json')).toBe('json'))
  it('maps Taskfile.yml to yaml', () => expect(detectLangFromPath('Taskfile.yml')).toBe('yaml'))
  it('maps .sh to bash', () => expect(detectLangFromPath('run.sh')).toBe('bash'))
  it('returns empty string for unknown extensions', () => expect(detectLangFromPath('a.xyz')).toBe(''))
  it('handles no extension', () => expect(detectLangFromPath('README')).toBe(''))
})
