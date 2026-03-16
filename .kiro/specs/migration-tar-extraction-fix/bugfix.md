# Documento de Requisitos del Bugfix

## Introducción

Al migrar proyectos entre servidores VPS, el script de importación falla con el error `bash: line 44: cd: /root/proyectos/evolution_api: No such file or directory`. Esto ocurre porque el tarball exportado contiene archivos con rutas relativas (creado con `tar -czf ... .`), pero el script de importación extrae directamente en `/root/proyectos/` sin crear el subdirectorio del proyecto. Los archivos se desparraman en el directorio padre en lugar de quedar dentro de `/root/proyectos/{nombre_proyecto}/`, y el posterior `cd "$PROJECT_DIR"` falla porque ese directorio nunca fue creado.

## Análisis del Bug

### Comportamiento Actual (Defecto)

1.1 CUANDO se importa un proyecto migrado ENTONCES el sistema extrae el tarball directamente en `/root/proyectos/` con `tar -xzvf "$TAR_FILE"`, causando que los archivos del proyecto se desparramen en el directorio base en lugar de quedar dentro del subdirectorio del proyecto

1.2 CUANDO se importa un proyecto migrado ENTONCES el sistema intenta hacer `cd "$PROJECT_DIR"` (ej. `/root/proyectos/evolution_api`) pero ese directorio nunca fue creado, resultando en el error `No such file or directory`

1.3 CUANDO se importa un proyecto migrado y se necesita reemplazar dominio ENTONCES el sistema falla al intentar acceder a archivos dentro de `$PROJECT_DIR` porque los archivos fueron extraídos en la ubicación incorrecta

### Comportamiento Esperado (Correcto)

2.1 CUANDO se importa un proyecto migrado ENTONCES el sistema DEBERÁ crear el directorio del proyecto con `mkdir -p "$PROJECT_DIR"` y extraer el tarball dentro de ese directorio usando `tar -xzvf "$TAR_FILE" -C "$PROJECT_DIR"`

2.2 CUANDO se importa un proyecto migrado ENTONCES el sistema DEBERÁ poder hacer `cd "$PROJECT_DIR"` exitosamente porque el directorio fue creado antes de la extracción

2.3 CUANDO se importa un proyecto migrado y se necesita reemplazar dominio ENTONCES el sistema DEBERÁ encontrar los archivos correctamente dentro de `$PROJECT_DIR` para realizar las sustituciones de dominio

### Comportamiento Sin Cambios (Prevención de Regresión)

3.1 CUANDO se importa un proyecto y ya existe un proyecto con el mismo nombre ENTONCES el sistema DEBERÁ CONTINUAR deteniendo los contenedores anteriores y eliminando el directorio existente antes de la extracción

3.2 CUANDO se importa un proyecto con un dump SQL ENTONCES el sistema DEBERÁ CONTINUAR restaurando la base de datos correctamente después de levantar los contenedores

3.3 CUANDO se importa un proyecto con un nuevo dominio especificado ENTONCES el sistema DEBERÁ CONTINUAR reemplazando el dominio antiguo por el nuevo en `docker-compose.yml` y `.env`

3.4 CUANDO se exporta un proyecto ENTONCES el sistema DEBERÁ CONTINUAR generando el tarball con rutas relativas desde el directorio del proyecto usando `tar -czf ... .`

3.5 CUANDO se importa un proyecto sin dominio nuevo ENTONCES el sistema DEBERÁ CONTINUAR manteniendo las configuraciones y dominio originales
