// Traefik setup script generator
// This creates the central reverse proxy that handles all SSL certificates

export function generateTraefikSetupScript(): string {
  return `#!/bin/bash

# ============================================
# Traefik Reverse Proxy Setup
# Central SSL/TLS Manager for Multiple Domains
# ============================================

set -e

GREEN='\\033[0;32m'
RED='\\033[0;31m'
YELLOW='\\033[1;33m'
CYAN='\\033[0;36m'
NC='\\033[0m'

echo -e "\${CYAN}"
echo "============================================"
echo "  🌐 Instalando Traefik Reverse Proxy"
echo "  🔒 Gestión centralizada de SSL/TLS"
echo "============================================"
echo -e "\${NC}"

TRAEFIK_DIR="/root/traefik"

# Check if Traefik is already installed
if [ -d "\$TRAEFIK_DIR" ] && docker ps | grep -q "traefik"; then
    echo -e "\${GREEN}✓ Traefik ya está instalado y corriendo\${NC}"
    echo -e "\${YELLOW}Verificando estado...\${NC}"
    docker ps | grep traefik
    echo ""
    echo -e "\${GREEN}✓ Traefik está listo para usar\${NC}"
    echo "TRAEFIK_ALREADY_INSTALLED"
    exit 0
fi

echo -e "\${YELLOW}📁 Creando estructura de Traefik...\${NC}"

mkdir -p "\$TRAEFIK_DIR"
touch "\$TRAEFIK_DIR/acme.json"
chmod 600 "\$TRAEFIK_DIR/acme.json"

echo -e "\${GREEN}✓ Estructura creada\${NC}"

# Create traefik.yml configuration
echo -e "\${YELLOW}⚙️  Generando configuración de Traefik...\${NC}"

cat > "\$TRAEFIK_DIR/traefik.yml" <<'TRAEFIK_CONFIG'
api:
  dashboard: true
  insecure: false

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: traefik_network

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@localhost
      storage: /acme.json
      httpChallenge:
        entryPoint: web
TRAEFIK_CONFIG

echo -e "\${GREEN}✓ traefik.yml creado\${NC}"

# Create docker-compose for Traefik
echo -e "\${YELLOW}🐳 Generando docker-compose.yml...\${NC}"

cat > "\$TRAEFIK_DIR/docker-compose.yml" <<'DOCKER_COMPOSE'
name: traefik

services:
  traefik:
    image: traefik:latest
    container_name: traefik
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik.yml:/traefik.yml:ro
      - ./acme.json:/acme.json
    networks:
      - traefik_network
    labels:
      - "traefik.enable=true"

networks:
  traefik_network:
    external: true
DOCKER_COMPOSE

echo -e "\${GREEN}✓ docker-compose.yml creado\${NC}"

# Create the shared network
echo -e "\${YELLOW}🔗 Creando red compartida traefik_network...\${NC}"
docker network create traefik_network 2>/dev/null || echo -e "\${YELLOW}Red ya existe\${NC}"
echo -e "\${GREEN}✓ Red traefik_network lista\${NC}"

# Start Traefik
echo -e "\${YELLOW}🚀 Iniciando Traefik...\${NC}"
cd "\$TRAEFIK_DIR"
docker compose up -d

sleep 5

# Verify
if docker ps | grep -q "traefik"; then
    echo -e "\${GREEN}✅ Traefik instalado y corriendo exitosamente\${NC}"
    echo ""
    docker ps | grep traefik
    echo ""
    echo -e "\${CYAN}============================================"
    echo "  ✅ TRAEFIK INSTALADO"
    echo "============================================\${NC}"
    echo ""
    echo -e "\${GREEN}Ahora todos los proyectos con dominio usarán:"
    echo "  • Puerto 80 → Redirección a HTTPS"
    echo "  • Puerto 443 → SSL automático (Let's Encrypt)"
    echo -e "\${NC}"
    echo "TRAEFIK_INSTALLED_SUCCESS"
else
    echo -e "\${RED}❌ Error al iniciar Traefik\${NC}"
    docker compose logs
    exit 1
fi
`;
}
