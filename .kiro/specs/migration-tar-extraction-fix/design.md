# Corrección de Extracción Tar en Migración - Diseño del Bugfix

## Resumen

El script de importación generado por `generateImportProjectScript` extrae el tarball directamente en `/root/proyectos/` sin crear primero el subdirectorio del proyecto. Como el script de exportación crea el tar con rutas relativas (`tar -czf ... .` desde dentro del directorio del proyecto), al extraer los archivos se desparraman en el directorio padre en lugar de quedar dentro de `/root/proyectos/{nombre_proyecto}/`. La corrección consiste en crear el subdirectorio con `mkdir -p "$PROJECT_DIR"` y extraer directamente ahí con `tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"`, eliminando el `cd "$PROJECTS_DIR"` previo a la extracción.

## Glosario

- **Bug_Condition (C)**: La condición que dispara el bug — cuando `generateImportProjectScript` genera un script que extrae el tarball sin crear el subdirectorio destino ni usar el flag `-C`
- **Property (P)**: El comportamiento deseado — el script generado debe crear `$PROJECT_DIR` con `mkdir -p` y extraer el tarball dentro de ese directorio usando `tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"`
- **Preservation**: El comportamiento existente que no debe cambiar — limpieza de proyectos existentes, restauración de BD, reemplazo de dominio, exportación con rutas relativas
- **generateImportProjectScript**: La función en `lib/project-manager.ts` que genera el script bash de importación de proyectos
- **generateExportProjectScript**: La función en `lib/project-manager.ts` que genera el script bash de exportación (no requiere cambios)

## Detalles del Bug

### Condición del Bug

El bug se manifiesta cuando se ejecuta el script generado por `generateImportProjectScript`. El script hace `cd "$PROJECTS_DIR"` y luego ejecuta `tar -xzvf "$TAR_FILE"` sin crear el subdirectorio del proyecto. Como el tarball contiene archivos con rutas relativas (`.`), estos se extraen directamente en `/root/proyectos/` en lugar de en `/root/proyectos/{nombre_proyecto}/`.

**Especificación Formal:**
```
FUNCTION isBugCondition(input)
  INPUT: input de tipo { projectName: string, projectType: string, newDomain: string | null }
  OUTPUT: boolean
  
  script := generateImportProjectScript(input.projectName, input.projectType, input.newDomain)
  
  RETURN script CONTIENE 'cd "$PROJECTS_DIR"' ANTES DE 'tar -xzvf'
         AND script NO CONTIENE 'mkdir -p "$PROJECT_DIR"' ANTES DE 'tar -xzvf'
         AND script NO CONTIENE 'tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"'
END FUNCTION
```

### Ejemplos

- **Importar proyecto "evolution_api"**: Se espera que los archivos queden en `/root/proyectos/evolution_api/`, pero actualmente se extraen en `/root/proyectos/` y el posterior `cd "$PROJECT_DIR"` falla con `No such file or directory`
- **Importar proyecto "mi_laravel" con dominio nuevo**: Se espera que los archivos queden en `/root/proyectos/mi_laravel/` para que el `sed` de reemplazo de dominio funcione, pero los archivos quedan en `/root/proyectos/` y el reemplazo falla
- **Importar proyecto "n8n_app" sin dominio**: Se espera extracción correcta en `/root/proyectos/n8n_app/`, pero los archivos se desparraman en el directorio padre
- **Importar proyecto que ya existe**: Se espera que primero limpie el existente, luego cree el directorio y extraiga correctamente

## Comportamiento Esperado

### Requisitos de Preservación

**Comportamientos Sin Cambios:**
- La limpieza de proyectos existentes (docker compose down + rm -rf) debe seguir funcionando antes de la extracción
- La restauración de base de datos SQL debe continuar funcionando después de levantar contenedores
- El reemplazo de dominio en docker-compose.yml y .env debe seguir funcionando cuando se especifica un nuevo dominio
- La función `generateExportProjectScript` no debe modificarse — sigue creando el tarball con rutas relativas
- La importación sin dominio nuevo debe seguir manteniendo las configuraciones originales

**Alcance:**
Todo lo que NO sea la sección de extracción del tarball en `generateImportProjectScript` debe quedar completamente intacto. Esto incluye:
- La lógica de verificación de existencia del tarball
- La lógica de limpieza de proyecto existente
- La lógica de reemplazo de dominio
- La lógica de levantamiento de contenedores Docker
- La lógica de restauración de base de datos
- La función `generateExportProjectScript`
- Las demás funciones del módulo (`generateListProjectsScript`, `generateRestartProjectScript`, `generateDeleteProjectScript`)

## Causa Raíz Hipotética

Basado en el análisis del bug, la causa raíz es clara y singular:

1. **Extracción sin directorio destino**: El script generado ejecuta `tar -xzvf "$TAR_FILE"` después de hacer `cd "$PROJECTS_DIR"`, lo que extrae los archivos con rutas relativas directamente en `/root/proyectos/`. Nunca se crea el subdirectorio `$PROJECT_DIR` ni se usa el flag `-C` para dirigir la extracción.

2. **Asimetría export/import**: El script de exportación crea el tar con `tar -czf $EXPORT_DIR/$PROJECT_NAME.tar.gz .` desde dentro del directorio del proyecto (rutas relativas), pero el script de importación no recrea esa estructura de directorio antes de extraer.

3. **`cd "$PROJECTS_DIR"` innecesario**: El script hace `cd "$PROJECTS_DIR"` antes de la extracción, lo cual es innecesario si se usa el flag `-C` para especificar el directorio destino directamente en el comando tar.

## Correctness Properties

Property 1: Bug Condition - Extracción del tarball en subdirectorio correcto

_For any_ input `(projectName, projectType, newDomain)` donde `projectName` es un string no vacío, el script generado por la función corregida `generateImportProjectScript` DEBERÁ contener `mkdir -p "$PROJECT_DIR"` seguido de `tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"`, y NO DEBERÁ contener `cd "$PROJECTS_DIR"` inmediatamente antes de la extracción.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Comportamiento de funciones no afectadas

_For any_ input `(projectName, projectType, newDomain)`, el script generado por la función corregida DEBERÁ producir exactamente el mismo contenido que la función original para todas las secciones que NO son la extracción del tarball, preservando la limpieza de proyectos existentes, restauración de BD, reemplazo de dominio, y levantamiento de contenedores.

**Validates: Requirements 3.1, 3.2, 3.3, 3.5**

Property 3: Preservation - Script de exportación sin cambios

_For any_ input `(projectName, projectType)`, la función `generateExportProjectScript` DEBERÁ producir exactamente el mismo script que antes de la corrección, preservando la creación del tarball con rutas relativas.

**Validates: Requirements 3.4**

## Implementación de la Corrección

### Cambios Requeridos

Asumiendo que nuestro análisis de causa raíz es correcto:

**Archivo**: `lib/project-manager.ts`

**Función**: `generateImportProjectScript`

**Cambios Específicos**:

1. **Eliminar `cd "$PROJECTS_DIR"`**: Remover la línea `'cd "$PROJECTS_DIR"'` que se ejecuta antes de la extracción, ya que no es necesaria cuando se usa el flag `-C`

2. **Agregar creación del directorio del proyecto**: Añadir `'mkdir -p "$PROJECT_DIR"'` antes del comando tar para asegurar que el subdirectorio existe

3. **Modificar comando tar para usar `-C`**: Cambiar `'tar -xzvf "$TAR_FILE" > /dev/null 2>&1'` por `'tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR" > /dev/null 2>&1'` para extraer directamente en el subdirectorio correcto

4. **Mantener `mkdir -p "$PROJECTS_DIR"`**: La línea existente que crea el directorio base `/root/proyectos/` debe permanecer

5. **No modificar ninguna otra sección**: La lógica de limpieza, reemplazo de dominio, contenedores Docker y restauración de BD permanece intacta

## Estrategia de Testing

### Enfoque de Validación

La estrategia de testing sigue un enfoque de dos fases: primero, generar contraejemplos que demuestren el bug en el código sin corregir, luego verificar que la corrección funciona y preserva el comportamiento existente.

### Exploración de la Condición del Bug

**Objetivo**: Generar contraejemplos que demuestren el bug ANTES de implementar la corrección. Confirmar o refutar el análisis de causa raíz.

**Plan de Test**: Llamar a `generateImportProjectScript` con diferentes combinaciones de parámetros y verificar que el script generado contiene el patrón defectuoso (`cd "$PROJECTS_DIR"` seguido de `tar -xzvf "$TAR_FILE"` sin `-C`).

**Casos de Test**:
1. **Import básico sin dominio**: Generar script con `("test_project", "php", null)` y verificar que contiene el patrón defectuoso (fallará en código sin corregir)
2. **Import Laravel con dominio**: Generar script con `("mi_laravel", "laravel", "ejemplo.com")` y verificar el patrón defectuoso (fallará en código sin corregir)
3. **Import docker-app sin dominio**: Generar script con `("n8n_app", "docker-app-n8n", null)` y verificar el patrón defectuoso (fallará en código sin corregir)

**Contraejemplos Esperados**:
- El script generado contiene `cd "$PROJECTS_DIR"` antes de `tar -xzvf "$TAR_FILE"` sin flag `-C`
- El script generado NO contiene `mkdir -p "$PROJECT_DIR"` antes de la extracción
- Causa confirmada: asimetría entre export (rutas relativas) e import (sin subdirectorio)

### Verificación de la Corrección (Fix Checking)

**Objetivo**: Verificar que para todas las entradas donde la condición del bug se cumple, la función corregida produce el comportamiento esperado.

**Pseudocódigo:**
```
FOR ALL input WHERE isBugCondition(input) DO
  script := generateImportProjectScript_fixed(input.projectName, input.projectType, input.newDomain)
  ASSERT script CONTIENE 'mkdir -p "$PROJECT_DIR"'
  ASSERT script CONTIENE 'tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"'
  ASSERT script NO CONTIENE 'cd "$PROJECTS_DIR"' INMEDIATAMENTE ANTES DE tar
END FOR
```

### Verificación de Preservación (Preservation Checking)

**Objetivo**: Verificar que para todas las entradas, la función corregida produce el mismo resultado que la original en todas las secciones no relacionadas con la extracción.

**Pseudocódigo:**
```
FOR ALL input DO
  scriptOriginal := generateImportProjectScript_original(input.projectName, input.projectType, input.newDomain)
  scriptFixed := generateImportProjectScript_fixed(input.projectName, input.projectType, input.newDomain)
  
  // Verificar que las secciones no-extracción son idénticas
  ASSERT seccionLimpieza(scriptOriginal) = seccionLimpieza(scriptFixed)
  ASSERT seccionDominio(scriptOriginal) = seccionDominio(scriptFixed)
  ASSERT seccionDocker(scriptOriginal) = seccionDocker(scriptFixed)
  ASSERT seccionDB(scriptOriginal) = seccionDB(scriptFixed)
END FOR
```

**Enfoque de Testing**: Se recomienda property-based testing para la verificación de preservación porque:
- Genera muchos casos de test automáticamente con diferentes combinaciones de projectName, projectType y newDomain
- Detecta casos borde que tests manuales podrían omitir
- Proporciona garantías fuertes de que el comportamiento no cambia para las secciones no afectadas

**Plan de Test**: Observar el comportamiento del código sin corregir para las secciones de limpieza, dominio, Docker y BD, luego escribir property-based tests que capturen ese comportamiento.

**Casos de Test**:
1. **Preservación de limpieza de proyecto existente**: Verificar que la lógica de `docker compose down` y `rm -rf` sigue presente en el script generado
2. **Preservación de restauración de BD**: Verificar que la sección de restauración SQL es idéntica antes y después de la corrección
3. **Preservación de reemplazo de dominio**: Verificar que la lógica de `sed` para reemplazar dominios es idéntica
4. **Preservación de export**: Verificar que `generateExportProjectScript` produce exactamente el mismo output

### Unit Tests

- Verificar que el script generado contiene `mkdir -p "$PROJECT_DIR"` antes de `tar`
- Verificar que el script generado contiene `tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"`
- Verificar que el script generado NO contiene `cd "$PROJECTS_DIR"` antes de la extracción
- Verificar con diferentes combinaciones de parámetros (con/sin dominio, diferentes tipos de proyecto)

### Property-Based Tests

- Generar nombres de proyecto aleatorios y verificar que el script siempre contiene la secuencia correcta de mkdir + tar con -C
- Generar combinaciones aleatorias de (projectName, projectType, newDomain) y verificar que las secciones no-extracción son idénticas entre la versión original y la corregida
- Verificar que `generateExportProjectScript` no cambia para ninguna combinación de inputs

### Integration Tests

- Test de flujo completo: generar script de export, luego script de import, y verificar que la secuencia de comandos es coherente (export con rutas relativas + import con mkdir y -C)
- Test de migración con reemplazo de dominio: verificar que el script de import con dominio nuevo tiene la extracción correcta Y el reemplazo de dominio funcional
- Test de re-importación: verificar que importar sobre un proyecto existente limpia correctamente y luego extrae en el subdirectorio correcto
