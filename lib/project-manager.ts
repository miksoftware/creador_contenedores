/**
 * Project Manager - Scripts para listar y eliminar proyectos del VPS
 */

/**
 * Genera un script bash que lista todos los proyectos en /root/proyectos/
 * Cada proyecto se imprime en una línea con formato:
 * PROJECT_LINE|name|type|phpVersion|domain|size|containersRunning|containersTotal
 */
export function generateListProjectsScript(): string {
    // Use single quotes for the heredoc-style approach to avoid TS template interpolation issues
    return [
        '#!/bin/bash',
        '',
        'PROJECTS_DIR="/root/proyectos"',
        '',
        'if [ ! -d "$PROJECTS_DIR" ]; then',
        '    echo "PROJECT_LIST_EMPTY"',
        '    exit 0',
        'fi',
        '',
        'echo "PROJECT_LIST_START"',
        '',
        'for dir in "$PROJECTS_DIR"/*/; do',
        '    [ ! -d "$dir" ] && continue',
        '    PNAME=$(basename "$dir")',
        '    ',
        '    PTYPE="unknown"',
        '    PPHP=""',
        '    PDOMAIN=""',
        '    CRUNNING=0',
        '    CTOTAL=0',
        '    ',
        '    if [ -f "$dir/docker-compose.yml" ]; then',
        '        CC=$(cat "$dir/docker-compose.yml" 2>/dev/null)',
        '        ',
        '        if echo "$CC" | grep -qi "n8nio/n8n"; then PTYPE="docker-app-n8n"',
        '        elif echo "$CC" | grep -qi "odoo"; then PTYPE="docker-app-odoo"',
        '        elif echo "$CC" | grep -qi "evolution-api"; then PTYPE="docker-app-evolution"',
        '        elif echo "$CC" | grep -qi "uptime-kuma"; then PTYPE="docker-app-uptime-kuma"',
        '        elif echo "$CC" | grep -qi "portainer"; then PTYPE="docker-app-portainer"',
        '        elif echo "$CC" | grep -qi "php:7.3"; then PTYPE="php"; PPHP="7.3"',
        '        elif echo "$CC" | grep -qi "php:8"; then',
        '            if echo "$CC" | grep -qi "artisan\\|laravel\\|composer"; then PTYPE="laravel"; else PTYPE="php"; fi',
        '            PPHP="8.3"',
        '        fi',
        '        ',
        '        # Try to extract domain from traefik Host rule',
        '        PDOMAIN=$(echo "$CC" | grep -oP "Host\\(\\\\?\\`\\K[^\\\\\\`]+" 2>/dev/null | head -1)',
        '        if [ -z "$PDOMAIN" ]; then',
        '            PDOMAIN=$(echo "$CC" | grep -oP "rule=Host\\(\\`\\K[^\\`]+" 2>/dev/null | head -1)',
        '        fi',
        '        [ -z "$PDOMAIN" ] && PDOMAIN=""',
        '        ',
        '        cd "$dir" 2>/dev/null',
        '        CTOTAL=$(docker compose ps -q 2>/dev/null | wc -l)',
        '        CRUNNING=$(docker compose ps --filter "status=running" -q 2>/dev/null | wc -l)',
        '    fi',
        '    ',
        '    PSIZE=$(du -sh "$dir" 2>/dev/null | awk \'{print $1}\')',
        '    [ -z "$PSIZE" ] && PSIZE="0"',
        '    ',
        '    echo "PROJECT_LINE|$PNAME|$PTYPE|$PPHP|$PDOMAIN|$PSIZE|$CRUNNING|$CTOTAL"',
        'done',
        '',
        'echo "PROJECT_LIST_END"',
    ].join('\n');
}

/**
 * Genera un script bash para reiniciar los contenedores de un proyecto
 * y limpiar caché (artisan optimize para Laravel)
 */
export function generateRestartProjectScript(projectName: string, projectType: string): string {
    const isLaravel = projectType === 'laravel';

    const lines = [
        '#!/bin/bash',
        '',
        'GREEN=\'\\033[0;32m\'',
        'RED=\'\\033[0;31m\'',
        'YELLOW=\'\\033[1;33m\'',
        'CYAN=\'\\033[0;36m\'',
        'NC=\'\\033[0m\'',
        '',
        `PROJECT_NAME="${projectName}"`,
        'PROJECT_DIR="/root/proyectos/$PROJECT_NAME"',
        '',
        'echo -e "${CYAN}"',
        'echo "============================================"',
        'echo "  🔄 Reiniciando Proyecto: $PROJECT_NAME"',
        'echo "============================================"',
        'echo -e "${NC}"',
        '',
        'if [ ! -d "$PROJECT_DIR" ]; then',
        '    echo -e "${RED}❌ Error: El proyecto \'$PROJECT_NAME\' no existe${NC}"',
        '    exit 1',
        'fi',
        '',
        'cd "$PROJECT_DIR"',
        '',
        'echo -e "${YELLOW}[1/3] 🐳 Reiniciando contenedores...${NC}"',
        'docker compose restart 2>/dev/null || docker-compose restart 2>/dev/null || true',
        'sleep 3',
        'echo -e "${GREEN}✓ Contenedores reiniciados${NC}"',
    ];

    if (isLaravel) {
        lines.push(
            '',
            'echo ""',
            'echo -e "${YELLOW}[2/3] 🧹 Limpiando caché Laravel...${NC}"',
            // Detect PHP container name
            `PHP_CONTAINER="${projectName}_php"`,
            'if docker ps --format "{{.Names}}" | grep -q "$PHP_CONTAINER"; then',
            '    docker exec "$PHP_CONTAINER" php artisan optimize:clear 2>/dev/null || true',
            '    docker exec "$PHP_CONTAINER" php artisan optimize 2>/dev/null || true',
            '    docker exec "$PHP_CONTAINER" php artisan config:cache 2>/dev/null || true',
            '    docker exec "$PHP_CONTAINER" php artisan route:cache 2>/dev/null || true',
            '    docker exec "$PHP_CONTAINER" php artisan view:cache 2>/dev/null || true',
            '    echo -e "${GREEN}✓ Caché Laravel limpiado y optimizado${NC}"',
            'else',
            '    echo -e "${YELLOW}⚠️  No se encontró contenedor PHP: $PHP_CONTAINER${NC}"',
            'fi',
        );
    } else {
        lines.push(
            '',
            'echo -e "${YELLOW}[2/3] 🧹 Limpiando caché PHP...${NC}"',
            `PHP_CONTAINER="${projectName}_php"`,
            'if docker ps --format "{{.Names}}" | grep -q "$PHP_CONTAINER"; then',
            '    docker exec "$PHP_CONTAINER" find /tmp -name "sess_*" -mtime +1 -delete 2>/dev/null || true',
            '    echo -e "${GREEN}✓ Sesiones antiguas limpiadas${NC}"',
            'else',
            '    echo -e "${GREEN}✓ Sin contenedor PHP para limpiar${NC}"',
            'fi',
        );
    }

    lines.push(
        '',
        'echo ""',
        'echo -e "${YELLOW}[3/3] 🔐 Ajustando permisos...${NC}"',
        'if [ -d "$PROJECT_DIR/public" ]; then',
        '    chown -R www-data:www-data "$PROJECT_DIR/public" 2>/dev/null || true',
        '    echo -e "${GREEN}✓ Permisos ajustados${NC}"',
        'elif [ -d "$PROJECT_DIR/src" ]; then',
        '    chown -R www-data:www-data "$PROJECT_DIR/src" 2>/dev/null || true',
        '    echo -e "${GREEN}✓ Permisos ajustados${NC}"',
        'else',
        '    echo -e "${GREEN}✓ Sin ajuste de permisos necesario${NC}"',
        'fi',
        '',
        'echo ""',
        'echo -e "${GREEN}"',
        'echo "============================================"',
        'echo "  ✅ Proyecto \'$PROJECT_NAME\' reiniciado"',
        'echo "============================================"',
        'echo -e "${NC}"',
    );

    return lines.join('\n');
}

/**
 * Genera un script bash para eliminar completamente un proyecto
 */
export function generateDeleteProjectScript(projectName: string): string {
    // Only the projectName comes from JS, rest is pure bash
    return [
        '#!/bin/bash',
        'set -e',
        '',
        'GREEN=\'\\033[0;32m\'',
        'RED=\'\\033[0;31m\'',
        'YELLOW=\'\\033[1;33m\'',
        'CYAN=\'\\033[0;36m\'',
        'NC=\'\\033[0m\'',
        '',
        `PROJECT_NAME="${projectName}"`,
        'PROJECT_DIR="/root/proyectos/$PROJECT_NAME"',
        '',
        'echo -e "${CYAN}"',
        'echo "============================================"',
        'echo "  🗑️  Eliminando Proyecto: $PROJECT_NAME"',
        'echo "============================================"',
        'echo -e "${NC}"',
        '',
        'if [ ! -d "$PROJECT_DIR" ]; then',
        '    echo -e "${RED}❌ Error: El proyecto \'$PROJECT_NAME\' no existe en $PROJECT_DIR${NC}"',
        '    exit 1',
        'fi',
        '',
        'echo ""',
        'echo -e "${YELLOW}[1/5] 🐳 Deteniendo contenedores Docker...${NC}"',
        'cd "$PROJECT_DIR" 2>/dev/null || true',
        'if [ -f "docker-compose.yml" ]; then',
        '    docker compose down -v --remove-orphans 2>/dev/null || true',
        '    echo -e "${GREEN}✓ docker compose down completado${NC}"',
        'else',
        '    echo -e "${YELLOW}⚠️  No se encontró docker-compose.yml${NC}"',
        'fi',
        '',
        'echo ""',
        'echo -e "${YELLOW}[2/5] 🗑️  Eliminando contenedores residuales...${NC}"',
        'for c in $(docker ps -a --filter "name=${PROJECT_NAME}" --format "{{.Names}}" 2>/dev/null); do',
        '    docker rm -f "$c" 2>/dev/null || true',
        '    echo -e "${GREEN}  ✓ Contenedor eliminado: $c${NC}"',
        'done',
        '',
        'echo ""',
        'echo -e "${YELLOW}[3/5] 💾 Eliminando volúmenes...${NC}"',
        'for v in $(docker volume ls --filter "name=${PROJECT_NAME}" --format "{{.Name}}" 2>/dev/null); do',
        '    docker volume rm "$v" 2>/dev/null || true',
        '    echo -e "${GREEN}  ✓ Volumen eliminado: $v${NC}"',
        'done',
        '',
        'echo ""',
        'echo -e "${YELLOW}[4/5] 🌐 Eliminando redes...${NC}"',
        'for n in $(docker network ls --filter "name=${PROJECT_NAME}" --format "{{.Name}}" 2>/dev/null); do',
        '    docker network rm "$n" 2>/dev/null || true',
        '    echo -e "${GREEN}  ✓ Red eliminada: $n${NC}"',
        'done',
        '',
        'echo ""',
        'echo -e "${YELLOW}[5/5] 📁 Eliminando archivos del proyecto...${NC}"',
        'rm -rf "$PROJECT_DIR"',
        'echo -e "${GREEN}✓ Carpeta eliminada: $PROJECT_DIR${NC}"',
        '',
        'echo ""',
        'echo -e "${GREEN}"',
        'echo "============================================"',
        'echo "  ✅ Proyecto \'$PROJECT_NAME\' eliminado"',
        'echo "============================================"',
        'echo -e "${NC}"',
    ].join('\n');
}
