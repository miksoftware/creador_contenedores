#!/bin/bash

# ============================================
# Script de Deploy Automático
# Proyecto: Droguería Aldemar
# Repositorio: https://github.com/miksoftware/ventas.git
# Uso: bash deploy.sh o simplemente: deploy
# ============================================

echo "=========================================="
echo "  🚀 Deploy Droguería Aldemar"
echo "  📦 Repo: miksoftware/ventas"
echo "=========================================="
echo ""

# Colores para mensajes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # Sin color

# Rutas del proyecto
PROJECT_DIR="/root/proyectos/drogueriaaldemar"
PUBLIC_DIR="$PROJECT_DIR/public"

# Ir a la carpeta del código
cd $PUBLIC_DIR

echo -e "${BLUE}📁 Directorio: $(pwd)${NC}"
echo ""

# ============================================
# PASO 1: Proteger archivos de configuración
# ============================================
echo -e "${YELLOW}[1/7] 🔒 Protegiendo archivos de configuración...${NC}"

# Ignorar archivos que no deben sobrescribirse
echo "class/classconexion.php" >> .git/info/exclude 2>/dev/null || true
echo "config.php" >> .git/info/exclude 2>/dev/null || true
echo "test_session.php" >> .git/info/exclude 2>/dev/null || true

echo -e "${GREEN}✓ Archivos de configuración protegidos${NC}"

# ============================================
# PASO 2: Guardar cambios locales
# ============================================
echo ""
echo -e "${YELLOW}[2/7] 💾 Guardando cambios locales temporalmente...${NC}"

# Guardar cambios locales (por si acaso)
git stash --quiet

echo -e "${GREEN}✓ Cambios locales guardados${NC}"

# ============================================
# PASO 3: Descargar cambios desde GitHub
# ============================================
echo ""
echo -e "${YELLOW}[3/7] ⬇️  Descargando cambios desde GitHub...${NC}"
echo -e "${BLUE}    Repositorio: miksoftware/ventas${NC}"

# Intentar pull desde main o master
if git pull origin main 2>/dev/null; then
    BRANCH="main"
    echo -e "${GREEN}✓ Cambios descargados desde rama 'main'${NC}"
elif git pull origin master 2>/dev/null; then
    BRANCH="master"
    echo -e "${GREEN}✓ Cambios descargados desde rama 'master'${NC}"
else
    echo -e "${RED}✗ Error al descargar cambios desde GitHub${NC}"
    echo -e "${YELLOW}⚠️  Verifica tu token de GitHub y conexión a internet${NC}"
    exit 1
fi

# Mostrar información del último commit
LAST_COMMIT=$(git log -1 --pretty=format:'%h - %s (%ar) por %an')
echo -e "${BLUE}    📝 Último commit: $LAST_COMMIT${NC}"

# ============================================
# PASO 4: Restaurar configuración local
# ============================================
echo ""
echo -e "${YELLOW}[4/7] 🔄 Restaurando configuración local...${NC}"

# Restaurar cambios guardados si los hay
git stash pop --quiet 2>/dev/null || true

# Verificar que la configuración de Docker esté correcta
if grep -q "mysql" class/classconexion.php 2>/dev/null; then
    echo -e "${GREEN}✓ Configuración de base de datos correcta (Docker)${NC}"
else
    echo -e "${RED}✗ Advertencia: Verifica la configuración de base de datos${NC}"
fi

# ============================================
# PASO 5: Ajustar permisos
# ============================================
echo ""
echo -e "${YELLOW}[5/7] 🔐 Ajustando permisos de archivos...${NC}"

# Dar permisos correctos
chown -R www-data:www-data $PUBLIC_DIR
find $PUBLIC_DIR -type d -exec chmod 755 {} \; 2>/dev/null
find $PUBLIC_DIR -type f -exec chmod 644 {} \; 2>/dev/null

echo -e "${GREEN}✓ Permisos ajustados correctamente${NC}"

# ============================================
# PASO 6: Limpiar caché y sesiones
# ============================================
echo ""
echo -e "${YELLOW}[6/7] 🧹 Limpiando caché y sesiones antiguas...${NC}"

# Limpiar sesiones antiguas (más de 24 horas)
docker exec drogueriaaldemar_php find /tmp -name "sess_*" -mtime +1 -delete 2>/dev/null || true

# Eliminar archivo de prueba si existe
rm -f $PUBLIC_DIR/test_session.php

echo -e "${GREEN}✓ Caché limpiado${NC}"

# ============================================
# PASO 7: Reiniciar servicios
# ============================================
echo ""
echo -e "${YELLOW}[7/7] 🔄 Reiniciando servicios Docker...${NC}"

cd $PROJECT_DIR

# Reiniciar PHP y Nginx
docker compose restart php nginx --quiet

# Esperar a que se inicien
sleep 3

echo -e "${GREEN}✓ Servicios reiniciados${NC}"

# ============================================
# Verificación final
# ============================================
echo ""
echo -e "${BLUE}📊 Estado de contenedores:${NC}"
docker compose ps

echo ""
echo -e "${GREEN}=========================================="
echo "  ✅ Deploy completado exitosamente"
echo "==========================================${NC}"
echo ""
echo -e "${BLUE}🌐 URL: https://drogueriaaldemar.com${NC}"
echo -e "${BLUE}📦 Repositorio: https://github.com/miksoftware/ventas${NC}"
echo -e "${BLUE}📅 Fecha: $(date '+%Y-%m-%d %H:%M:%S')${NC}"
echo -e "${BLUE}🔀 Rama: $BRANCH${NC}"
echo ""
