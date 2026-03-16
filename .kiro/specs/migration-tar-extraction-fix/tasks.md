# Plan de Implementación

- [x] 1. Escribir test de exploración de la condición del bug
  - **Property 1: Bug Condition** - Extracción del tarball sin subdirectorio destino
  - **CRITICAL**: Este test DEBE FALLAR en el código sin corregir — el fallo confirma que el bug existe
  - **NO intentes corregir el test ni el código cuando falle**
  - **NOTA**: Este test codifica el comportamiento esperado — validará la corrección cuando pase después de la implementación
  - **GOAL**: Generar contraejemplos que demuestren que el bug existe
  - **Enfoque PBT con alcance determinista**: Para cualquier `projectName` no vacío, con cualquier `projectType` y `newDomain` (null o string), el script generado por `generateImportProjectScript` DEBE contener `mkdir -p "$PROJECT_DIR"` antes de `tar` y DEBE contener `tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"`, y NO DEBE contener `cd "$PROJECTS_DIR"` inmediatamente antes de la extracción
  - Importar `generateImportProjectScript` desde `@/lib/project-manager`
  - Generar el script con diferentes combinaciones: `("test_project", "php", null)`, `("mi_laravel", "laravel", "ejemplo.com")`, `("n8n_app", "docker-app-n8n", null)`
  - Verificar que el script generado contiene `mkdir -p "$PROJECT_DIR"` antes de `tar -xzvf`
  - Verificar que el script generado contiene `tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"`
  - Verificar que el script generado NO contiene `cd "$PROJECTS_DIR"` inmediatamente antes de `tar -xzvf`
  - Ejecutar test en código SIN CORREGIR — esperar FALLO (esto confirma que el bug existe)
  - Documentar contraejemplos encontrados (ej. "el script contiene `cd "$PROJECTS_DIR"` seguido de `tar -xzvf "$TAR_FILE"` sin `-C`, confirmando la asimetría export/import")
  - Marcar tarea como completada cuando el test esté escrito, ejecutado, y el fallo documentado
  - _Requirements: 1.1, 1.2, 1.3, 2.1_

- [x] 2. Escribir tests de preservación basados en propiedades (ANTES de implementar la corrección)
  - **Property 2: Preservation** - Comportamiento de secciones no afectadas por la corrección
  - **IMPORTANTE**: Seguir metodología de observación primero
  - Observar: Generar scripts con `generateImportProjectScript` en código sin corregir para diferentes combinaciones de parámetros
  - Observar: La sección de limpieza de proyecto existente (`docker compose down -v` + `rm -rf "$PROJECT_DIR"`) está presente en el script generado
  - Observar: La sección de restauración de BD (detección de contenedor DB, restauración SQL) es idéntica para cualquier input
  - Observar: La sección de reemplazo de dominio (sed con OLD_DOMAIN/NEW_DOMAIN) aparece cuando `newDomain` no es null
  - Observar: La sección de levantamiento de contenedores (`docker compose up -d`) está presente
  - Observar: `generateExportProjectScript` produce el mismo script con `tar -czf $EXPORT_DIR/$PROJECT_NAME.tar.gz .` para cualquier input
  - Escribir property-based test: para cualquier combinación de `(projectName, projectType, newDomain)`, las secciones de limpieza, dominio, Docker y BD del script generado son idénticas entre la versión original y la corregida
  - Escribir property-based test: para cualquier `(projectName, projectType)`, `generateExportProjectScript` produce exactamente el mismo output antes y después de la corrección
  - Verificar que los tests PASAN en código SIN CORREGIR
  - Marcar tarea como completada cuando los tests estén escritos, ejecutados, y pasando en código sin corregir
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Corrección de extracción tar en generateImportProjectScript

  - [x] 3.1 Implementar la corrección en `lib/project-manager.ts`
    - Eliminar la línea `'cd "$PROJECTS_DIR"'` que aparece antes de la extracción tar (después de `mkdir -p "$PROJECTS_DIR"`)
    - Agregar `'mkdir -p "$PROJECT_DIR"'` antes del comando tar para crear el subdirectorio del proyecto
    - Cambiar `'tar -xzvf "$TAR_FILE" > /dev/null 2>&1'` por `'tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR" > /dev/null 2>&1'` para extraer en el subdirectorio correcto
    - Mantener `'mkdir -p "$PROJECTS_DIR"'` existente (crea el directorio base)
    - NO modificar ninguna otra sección de la función (limpieza, dominio, Docker, BD)
    - NO modificar `generateExportProjectScript` ni ninguna otra función del módulo
    - _Bug_Condition: isBugCondition(input) donde script CONTIENE `cd "$PROJECTS_DIR"` antes de tar Y NO CONTIENE `mkdir -p "$PROJECT_DIR"` antes de tar Y NO CONTIENE `tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"`_
    - _Expected_Behavior: script CONTIENE `mkdir -p "$PROJECT_DIR"` seguido de `tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"` Y NO CONTIENE `cd "$PROJECTS_DIR"` antes de tar_
    - _Preservation: Secciones de limpieza, dominio, Docker, BD y export permanecen idénticas_
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Verificar que el test de exploración del bug ahora pasa
    - **Property 1: Expected Behavior** - Extracción del tarball en subdirectorio correcto
    - **IMPORTANTE**: Re-ejecutar el MISMO test de la tarea 1 — NO escribir un test nuevo
    - El test de la tarea 1 codifica el comportamiento esperado
    - Cuando este test pase, confirma que el comportamiento esperado se cumple
    - Ejecutar test de exploración de la condición del bug de la tarea 1
    - **RESULTADO ESPERADO**: Test PASA (confirma que el bug está corregido)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.3 Verificar que los tests de preservación siguen pasando
    - **Property 2: Preservation** - Comportamiento de secciones no afectadas
    - **IMPORTANTE**: Re-ejecutar los MISMOS tests de la tarea 2 — NO escribir tests nuevos
    - Ejecutar tests de preservación de propiedades de la tarea 2
    - **RESULTADO ESPERADO**: Tests PASAN (confirma que no hay regresiones)
    - Confirmar que todos los tests siguen pasando después de la corrección (sin regresiones)

- [x] 4. Checkpoint - Asegurar que todos los tests pasan
  - Asegurar que todos los tests pasan, preguntar al usuario si surgen dudas.
