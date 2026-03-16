import { describe, it, expect } from 'vitest'
import { generateImportProjectScript } from '@/lib/project-manager'
import * as fc from 'fast-check'

/**
 * Bug Condition Exploration Test — Property 1
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1
 *
 * This test encodes the EXPECTED (correct) behavior:
 * - The script MUST contain `mkdir -p "$PROJECT_DIR"` before `tar`
 * - The script MUST contain `tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"`
 * - The script MUST NOT contain `cd "$PROJECTS_DIR"` immediately before `tar -xzvf`
 *
 * On UNFIXED code, this test is EXPECTED TO FAIL — failure confirms the bug exists.
 */
describe('Bug Condition — Extracción del tarball sin subdirectorio destino', () => {
  const testCases: Array<{ projectName: string; projectType: string; newDomain: string | null }> = [
    { projectName: 'test_project', projectType: 'php', newDomain: null },
    { projectName: 'mi_laravel', projectType: 'laravel', newDomain: 'ejemplo.com' },
    { projectName: 'n8n_app', projectType: 'docker-app-n8n', newDomain: null },
  ]

  for (const { projectName, projectType, newDomain } of testCases) {
    const label = `${projectName} (${projectType}, domain=${newDomain ?? 'null'})`

    it(`should create PROJECT_DIR before extraction: ${label}`, () => {
      const script = generateImportProjectScript(projectName, projectType, newDomain)
      const lines = script.split('\n')

      // Find the tar extraction line
      const tarLineIndex = lines.findIndex((l) => l.includes('tar -xzvf'))
      expect(tarLineIndex).toBeGreaterThan(-1)

      // There must be a `mkdir -p "$PROJECT_DIR"` BEFORE the tar line
      const mkdirIndex = lines.findIndex((l) => l.includes('mkdir -p "$PROJECT_DIR"'))
      expect(mkdirIndex).toBeGreaterThan(-1)
      expect(mkdirIndex).toBeLessThan(tarLineIndex)
    })

    it(`should extract tar into PROJECT_DIR with -C flag: ${label}`, () => {
      const script = generateImportProjectScript(projectName, projectType, newDomain)

      expect(script).toContain('tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"')
    })

    it(`should NOT cd into PROJECTS_DIR immediately before tar extraction: ${label}`, () => {
      const script = generateImportProjectScript(projectName, projectType, newDomain)
      const lines = script.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'))

      const tarLineIndex = lines.findIndex((l) => l.includes('tar -xzvf'))
      expect(tarLineIndex).toBeGreaterThan(-1)

      // Check that `cd "$PROJECTS_DIR"` does NOT appear as a non-comment line
      // immediately before the tar extraction (within 3 lines before, excluding blanks/comments)
      const precedingLines = lines.slice(Math.max(0, tarLineIndex - 5), tarLineIndex)
      const hasCdProjectsDir = precedingLines.some((l) => l.includes('cd "$PROJECTS_DIR"'))
      expect(hasCdProjectsDir).toBe(false)
    })
  }

  /**
   * **Validates: Requirements 1.1, 1.2, 1.3, 2.1**
   *
   * Property-based test: for ANY non-empty projectName, with any projectType
   * and newDomain, the generated script must have the correct extraction pattern.
   */
  it('PBT: for any valid input, script must create PROJECT_DIR and extract with -C flag', () => {
    const projectTypes = ['php', 'laravel', 'docker-app-n8n', 'docker-app-odoo', 'docker-app-evolution']

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
        fc.constantFrom(...projectTypes),
        fc.option(fc.webUrl(), { nil: null }),
        (projectName, projectType, newDomain) => {
          const script = generateImportProjectScript(projectName, projectType, newDomain)
          const lines = script.split('\n')

          // 1. Must contain mkdir -p "$PROJECT_DIR" before tar
          const mkdirIndex = lines.findIndex((l) => l.includes('mkdir -p "$PROJECT_DIR"'))
          const tarIndex = lines.findIndex((l) => l.includes('tar -xzvf'))

          if (mkdirIndex === -1) return false
          if (tarIndex === -1) return false
          if (mkdirIndex >= tarIndex) return false

          // 2. Must contain tar with -C "$PROJECT_DIR"
          if (!script.includes('tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"')) return false

          // 3. Must NOT have cd "$PROJECTS_DIR" immediately before tar
          const nonEmptyLines = lines
            .map((l) => l.trim())
            .filter((l) => l.length > 0 && !l.startsWith('#'))
          const tarIdx = nonEmptyLines.findIndex((l) => l.includes('tar -xzvf'))
          const preceding = nonEmptyLines.slice(Math.max(0, tarIdx - 5), tarIdx)
          if (preceding.some((l) => l.includes('cd "$PROJECTS_DIR"'))) return false

          return true
        },
      ),
      { numRuns: 100 },
    )
  })
})
