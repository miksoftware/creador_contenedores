import { describe, it, expect } from 'vitest'
import { generateImportProjectScript, generateExportProjectScript } from '@/lib/project-manager'
import * as fc from 'fast-check'

/**
 * Preservation Property Tests — Property 2 & Property 3
 *
 * These tests capture the CURRENT behavior of sections that must NOT change
 * after the bug fix is applied. They must PASS on unfixed code.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
 */

// ─── Helpers to extract script sections ───────────────────────────────────────

/**
 * Extracts the cleanup section: from the "Eliminar proyecto si ya existe"
 * comment through the closing `fi` of that block.
 */
function extractCleanupSection(script: string): string | null {
  const lines = script.split('\n')
  const startIdx = lines.findIndex((l) => l.includes('# Eliminar proyecto si ya existe'))
  if (startIdx === -1) return null

  // Find the closing `fi` for this if-block
  let depth = 0
  let endIdx = startIdx
  for (let i = startIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('if ') || trimmed.startsWith('if [')) depth++
    if (trimmed === 'fi') {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }

  return lines.slice(startIdx, endIdx + 1).join('\n')
}

/**
 * Extracts the DB restoration section: from "[4/4]" echo through the final
 * `fi` that closes the outer `if [ -f "$SQL_FILE" ]` block.
 */
function extractDBSection(script: string): string | null {
  const lines = script.split('\n')
  const startIdx = lines.findIndex((l) => l.includes('[4/4]'))
  if (startIdx === -1) return null

  // Find the outer `if [ -f "$SQL_FILE" ]` and its closing fi
  const sqlIfIdx = lines.findIndex((l, i) => i >= startIdx && l.includes('if [ -f "$SQL_FILE" ]'))
  if (sqlIfIdx === -1) return null

  let depth = 0
  let endIdx = sqlIfIdx
  for (let i = sqlIfIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith('if ') || trimmed.startsWith('if [')) depth++
    if (trimmed === 'fi') {
      depth--
      if (depth === 0) {
        endIdx = i
        break
      }
    }
  }

  return lines.slice(startIdx, endIdx + 1).join('\n')
}

/**
 * Extracts the Docker startup section: the `docker compose up -d` line
 * and surrounding echo/sleep lines.
 */
function extractDockerSection(script: string): string | null {
  const lines = script.split('\n')
  const startIdx = lines.findIndex((l) => l.includes('[3/4]'))
  if (startIdx === -1) return null

  // Collect lines from [3/4] until the blank line before [4/4]
  const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('[4/4]'))
  if (endIdx === -1) return null

  return lines.slice(startIdx, endIdx).join('\n')
}

/**
 * Extracts the domain replacement section when newDomain is provided.
 * From [2/4] echo through the end of the domain block.
 */
function extractDomainSection(script: string): string | null {
  const lines = script.split('\n')
  const startIdx = lines.findIndex((l) => l.includes('[2/4]'))
  if (startIdx === -1) return null

  const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('[3/4]'))
  if (endIdx === -1) return null

  return lines.slice(startIdx, endIdx).join('\n')
}

/**
 * Extracts the final success/completion section of the import script.
 */
function extractCompletionSection(script: string): string | null {
  const lines = script.split('\n')
  const startIdx = lines.findIndex((l) => l.includes('IMPORT_SUCCESS'))
  if (startIdx === -1) return null
  // Include a few lines before IMPORT_SUCCESS (the echo block)
  const blockStart = lines.findLastIndex((l, i) => i < startIdx && l.includes('rm -f "$TAR_FILE"'))
  return lines.slice(blockStart !== -1 ? blockStart : startIdx, startIdx + 1).join('\n')
}

// ─── Generators ───────────────────────────────────────────────────────────────

const projectNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => /^[a-zA-Z0-9_-]+$/.test(s))

const projectTypeArb = fc.constantFrom('php', 'laravel', 'docker-app-n8n', 'docker-app-odoo', 'docker-app-evolution')

const domainArb = fc.oneof(
  fc.constant(null),
  fc.domain().map((d) => d),
)

// ─── Property 2: Preservation — Import script sections ────────────────────────

describe('Preservation — Import script non-extraction sections', () => {

  /**
   * **Validates: Requirements 3.1**
   *
   * Property: For any (projectName, projectType, newDomain), the cleanup section
   * always contains `docker compose down -v` and `rm -rf "$PROJECT_DIR"`.
   */
  it('PBT: cleanup section always contains docker compose down and rm -rf for any input', () => {
    fc.assert(
      fc.property(projectNameArb, projectTypeArb, domainArb, (projectName, projectType, newDomain) => {
        const script = generateImportProjectScript(projectName, projectType, newDomain)
        const cleanup = extractCleanupSection(script)

        // Cleanup section must exist
        if (!cleanup) return false

        // Must contain docker compose down -v
        if (!cleanup.includes('docker compose down -v')) return false

        // Must contain rm -rf "$PROJECT_DIR"
        if (!cleanup.includes('rm -rf "$PROJECT_DIR"')) return false

        // Must be inside an if-block checking for existing project
        if (!cleanup.includes('if [ -d "$PROJECT_DIR" ]')) return false

        return true
      }),
      { numRuns: 100 },
    )
  })

  /**
   * **Validates: Requirements 3.2**
   *
   * Property: For any (projectName, projectType, newDomain), the DB restoration
   * section contains the expected DB container detection and SQL restore logic.
   */
  it('PBT: DB restoration section is present and contains expected logic for any input', () => {
    fc.assert(
      fc.property(projectNameArb, projectTypeArb, domainArb, (projectName, projectType, newDomain) => {
        const script = generateImportProjectScript(projectName, projectType, newDomain)
        const dbSection = extractDBSection(script)

        // DB section must exist
        if (!dbSection) return false

        // Must check for SQL_FILE
        if (!dbSection.includes('if [ -f "$SQL_FILE" ]')) return false

        // Must detect DB container (mariadb, mysql, db, database, postgres)
        if (!dbSection.includes('docker compose ps -q mariadb')) return false
        if (!dbSection.includes('docker compose ps -q mysql')) return false
        if (!dbSection.includes('docker compose ps -q postgres')) return false

        // Must have PostgreSQL restore path
        if (!dbSection.includes('psql -U "$DB_USER"')) return false

        // Must have MySQL/MariaDB restore path
        if (!dbSection.includes('mysql -u root')) return false

        // Must clean up SQL file
        if (!dbSection.includes('rm -f "$SQL_FILE"')) return false

        return true
      }),
      { numRuns: 100 },
    )
  })

  /**
   * **Validates: Requirements 3.3, 3.5**
   *
   * Property: When newDomain is provided, the domain replacement section contains
   * sed commands for OLD_DOMAIN/NEW_DOMAIN. When newDomain is null, the section
   * indicates original configurations are maintained.
   */
  it('PBT: domain section behaves correctly based on newDomain presence', () => {
    fc.assert(
      fc.property(projectNameArb, projectTypeArb, domainArb, (projectName, projectType, newDomain) => {
        const script = generateImportProjectScript(projectName, projectType, newDomain)
        const domainSection = extractDomainSection(script)

        // Domain section must exist
        if (!domainSection) return false

        const hasNewDomain = newDomain !== null && newDomain.trim().length > 0

        if (hasNewDomain) {
          // Must contain sed replacement commands
          if (!domainSection.includes('sed -i')) return false
          // Must reference OLD_DOMAIN and NEW_DOMAIN
          if (!domainSection.includes('$OLD_DOMAIN')) return false
          if (!domainSection.includes('$NEW_DOMAIN')) return false
          // Must target docker-compose.yml
          if (!domainSection.includes('docker-compose.yml')) return false
        } else {
          // Must indicate original config is maintained
          if (!domainSection.includes('Manteniendo configuraciones')) return false
        }

        return true
      }),
      { numRuns: 100 },
    )
  })

  /**
   * **Validates: Requirements 3.1**
   *
   * Property: For any input, the Docker startup section contains `docker compose up -d`.
   */
  it('PBT: Docker startup section always contains docker compose up -d', () => {
    fc.assert(
      fc.property(projectNameArb, projectTypeArb, domainArb, (projectName, projectType, newDomain) => {
        const script = generateImportProjectScript(projectName, projectType, newDomain)
        const dockerSection = extractDockerSection(script)

        // Docker section must exist
        if (!dockerSection) return false

        // Must contain docker compose up -d
        if (!dockerSection.includes('docker compose up -d')) return false

        return true
      }),
      { numRuns: 100 },
    )
  })

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.5**
   *
   * Property: The cleanup section content is identical for any two inputs
   * (it does not depend on projectName, projectType, or newDomain).
   */
  it('PBT: cleanup section is identical regardless of input parameters', () => {
    fc.assert(
      fc.property(
        projectNameArb,
        projectTypeArb,
        domainArb,
        projectNameArb,
        projectTypeArb,
        domainArb,
        (name1, type1, domain1, name2, type2, domain2) => {
          const script1 = generateImportProjectScript(name1, type1, domain1)
          const script2 = generateImportProjectScript(name2, type2, domain2)

          const cleanup1 = extractCleanupSection(script1)
          const cleanup2 = extractCleanupSection(script2)

          // Both must exist and be identical
          return cleanup1 !== null && cleanup2 !== null && cleanup1 === cleanup2
        },
      ),
      { numRuns: 100 },
    )
  })

  /**
   * **Validates: Requirements 3.2**
   *
   * Property: The DB restoration section is identical for any two inputs with
   * the same projectName (since DB section references PROJECT_NAME in the filter).
   */
  it('PBT: DB restoration section is identical for same projectName regardless of type/domain', () => {
    fc.assert(
      fc.property(
        projectNameArb,
        projectTypeArb,
        domainArb,
        projectTypeArb,
        domainArb,
        (projectName, type1, domain1, type2, domain2) => {
          const script1 = generateImportProjectScript(projectName, type1, domain1)
          const script2 = generateImportProjectScript(projectName, type2, domain2)

          const db1 = extractDBSection(script1)
          const db2 = extractDBSection(script2)

          return db1 !== null && db2 !== null && db1 === db2
        },
      ),
      { numRuns: 100 },
    )
  })

  /**
   * **Validates: Requirements 3.1**
   *
   * Property: The completion section (IMPORT_SUCCESS) is always present.
   */
  it('PBT: completion section with IMPORT_SUCCESS is always present', () => {
    fc.assert(
      fc.property(projectNameArb, projectTypeArb, domainArb, (projectName, projectType, newDomain) => {
        const script = generateImportProjectScript(projectName, projectType, newDomain)
        return script.includes('IMPORT_SUCCESS|Completado')
      }),
      { numRuns: 100 },
    )
  })
})

// ─── Property 3: Preservation — Export script unchanged ───────────────────────

describe('Preservation — Export script unchanged', () => {
  /**
   * **Validates: Requirements 3.4**
   *
   * Property: For any (projectName, projectType), generateExportProjectScript
   * produces a script that contains `tar -czf $EXPORT_DIR/$PROJECT_NAME.tar.gz .`
   * and the expected structure.
   */
  it('PBT: export script always contains tar with relative paths for any input', () => {
    fc.assert(
      fc.property(projectNameArb, projectTypeArb, (projectName, projectType) => {
        const script = generateExportProjectScript(projectName, projectType)

        // Must contain tar with relative paths
        if (!script.includes('tar -czf $EXPORT_DIR/$PROJECT_NAME.tar.gz .')) return false

        // Must contain project dir
        if (!script.includes(`export PROJECT_NAME="${projectName}"`)) return false

        // Must contain docker compose down before tar
        if (!script.includes('docker compose down')) return false

        // Must contain docker compose up -d after tar
        if (!script.includes('docker compose up -d')) return false

        // Must contain EXPORT_SUCCESS marker
        if (!script.includes('EXPORT_SUCCESS')) return false

        return true
      }),
      { numRuns: 100 },
    )
  })

  /**
   * **Validates: Requirements 3.4**
   *
   * Property: For any two inputs with the same projectName, the export script
   * is identical (projectType is not used in the export script).
   */
  it('PBT: export script is identical for same projectName regardless of projectType', () => {
    fc.assert(
      fc.property(projectNameArb, projectTypeArb, projectTypeArb, (projectName, type1, type2) => {
        const script1 = generateExportProjectScript(projectName, type1)
        const script2 = generateExportProjectScript(projectName, type2)
        return script1 === script2
      }),
      { numRuns: 100 },
    )
  })

  /**
   * **Validates: Requirements 3.4**
   *
   * Property: The export script has exactly the expected number of lines
   * and structure for any input.
   */
  it('PBT: export script has consistent structure for any input', () => {
    fc.assert(
      fc.property(projectNameArb, projectTypeArb, (projectName, projectType) => {
        const script = generateExportProjectScript(projectName, projectType)
        const lines = script.split('\n')

        // Must start with shebang
        if (lines[0] !== '#!/bin/bash') return false

        // Must have set -e
        if (lines[1] !== 'set -e') return false

        // Line count should be consistent across all inputs
        // (the export script structure does not vary by projectName/projectType)
        const referenceScript = generateExportProjectScript('ref', 'php')
        const referenceLines = referenceScript.split('\n')
        if (lines.length !== referenceLines.length) return false

        return true
      }),
      { numRuns: 100 },
    )
  })
})
