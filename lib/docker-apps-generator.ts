export type DockerApp = 'n8n' | 'odoo' | 'evolution-api' | 'uptime-kuma' | 'portainer';

export type DockerAppConfig = {
  appName: DockerApp;
  projectName: string;
  domain: string;
  forceOverwrite?: boolean;
};

export const DOCKER_APPS: Record<DockerApp, { label: string; description: string; icon: string; defaultPort: number; hasDb: boolean }> = {
  'n8n': { label: 'n8n', description: 'Workflow Automation', icon: '🔄', defaultPort: 5678, hasDb: false },
  'odoo': { label: 'Odoo', description: 'ERP & CRM', icon: '📊', defaultPort: 8069, hasDb: true },
  'evolution-api': { label: 'Evolution API', description: 'WhatsApp API', icon: '💬', defaultPort: 8080, hasDb: true },
  'uptime-kuma': { label: 'Uptime Kuma', description: 'Server Monitoring', icon: '📡', defaultPort: 3001, hasDb: false },
  'portainer': { label: 'Portainer', description: 'Docker Management', icon: '🐳', defaultPort: 9000, hasDb: false },
};

export function generateDockerAppScript(config: DockerAppConfig): string {
  const { appName, projectName, domain, forceOverwrite } = config;
  const hasDomain = !!domain && domain !== 'localhost' && domain.trim() !== '';

  switch (appName) {
    case 'n8n': return generateN8nScript(projectName, domain, hasDomain, forceOverwrite);
    case 'odoo': return generateOdooScript(projectName, domain, hasDomain, forceOverwrite);
    case 'evolution-api': return generateEvolutionScript(projectName, domain, hasDomain, forceOverwrite);
    case 'uptime-kuma': return generateUptimeKumaScript(projectName, domain, hasDomain, forceOverwrite);
    case 'portainer': return generatePortainerScript(projectName, domain, hasDomain, forceOverwrite);
    default: throw new Error(`App ${appName} not supported`);
  }
}

function scriptHeader(projectName: string, appLabel: string, domain: string, hasDomain: boolean): string {
  return `#!/bin/bash

# ============================================
# Docker App Deployer: ${appLabel}
# Proyecto: ${projectName}
# ============================================

set -e

PROJECT_NAME="${projectName}"
DOMAIN="${domain || ''}"
HAS_DOMAIN="${hasDomain}"

GREEN='\\033[0;32m'
RED='\\033[0;31m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
CYAN='\\033[0;36m'
NC='\\033[0m'

echo -e "\${CYAN}"
echo "============================================"
echo "  🚀 Instalando: ${appLabel}"
echo "  📦 Proyecto: \$PROJECT_NAME"
if [ "\$HAS_DOMAIN" = "true" ]; then
    echo "  🌐 Dominio: \$DOMAIN (con Traefik + SSL)"
fi
echo "============================================"
echo -e "\${NC}"

# ============================================
# VERIFICAR/INSTALAR DOCKER
# ============================================

if ! command -v docker &> /dev/null; then
    echo -e "\${YELLOW}📦 Docker no encontrado. Instalando...\${NC}"
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg lsb-release > /dev/null 2>&1
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/\$(. /etc/os-release && echo "\$ID")/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=\$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/\$(. /etc/os-release && echo "\$ID") \$(. /etc/os-release && echo "\$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin > /dev/null 2>&1
    systemctl start docker
    systemctl enable docker
    echo -e "\${GREEN}✓ Docker instalado correctamente\${NC}"
else
    echo -e "\${GREEN}✓ Docker ya está instalado: \$(docker --version)\${NC}"
fi

# Detectar subdominio
DOMAIN_PARTS=\$(echo "\$DOMAIN" | tr '.' '\\n' | wc -l)
if [ "\$DOMAIN_PARTS" -gt 2 ]; then
    IS_SUBDOMAIN="true"
else
    IS_SUBDOMAIN="false"
fi
`;
}

function traefikSetupBlock(): string {
  return `
# ============================================
# VERIFICAR/INSTALAR TRAEFIK SI HAY DOMINIO
# ============================================

if [ "\$HAS_DOMAIN" = "true" ]; then
    echo ""
    echo -e "\${YELLOW}🔍 Verificando Traefik...\${NC}"
    
    if ! docker ps | grep -q "traefik"; then
        echo -e "\${YELLOW}📦 Traefik no encontrado. Instalando...\${NC}"
        
        for container in \$(docker ps --format '{{.Names}}'); do
            ports=\$(docker port "\$container" 2>/dev/null | grep -E "(^80/|:80\$|^443/|:443\$)" || true)
            if [ -n "\$ports" ]; then
                docker stop "\$container" 2>/dev/null || true
            fi
        done

        if ss -tuln 2>/dev/null | grep -qE ":80\\\\s|:443\\\\s"; then
            fuser -k 80/tcp 2>/dev/null || true
            fuser -k 443/tcp 2>/dev/null || true
            sleep 2
        fi
        
        TRAEFIK_DIR="/root/traefik"
        mkdir -p "\$TRAEFIK_DIR"
        touch "\$TRAEFIK_DIR/acme.json"
        chmod 600 "\$TRAEFIK_DIR/acme.json"
        
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

        cat > "\$TRAEFIK_DIR/docker-compose.yml" <<'DOCKER_COMPOSE'
name: traefik
services:
  traefik:
    image: traefik:v3.4
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

        docker network create traefik_network 2>/dev/null || true
        cd "\$TRAEFIK_DIR"
        docker compose up -d
        sleep 5
        
        if docker ps | grep -q "traefik"; then
            echo -e "\${GREEN}✓ Traefik instalado\${NC}"
        else
            echo -e "\${RED}❌ Error instalando Traefik\${NC}"
            exit 1
        fi
    else
        echo -e "\${GREEN}✓ Traefik ya está corriendo\${NC}"
        docker network create traefik_network 2>/dev/null || true
    fi
fi
`;
}

function projectCheckBlock(forceOverwrite?: boolean): string {
  return `
# ============================================
# VERIFICAR PROYECTO EXISTENTE
# ============================================

PROJECT_DIR="/root/proyectos/\${PROJECT_NAME}"

if [ -d "\$PROJECT_DIR" ]; then
    if [ "${forceOverwrite ? 'true' : 'false'}" = "true" ]; then
        echo -e "\${YELLOW}⚠️  Eliminando proyecto existente...\${NC}"
        cd "\$PROJECT_DIR" 2>/dev/null || true
        docker compose down -v --remove-orphans 2>/dev/null || true
        rm -rf "\$PROJECT_DIR"
        echo -e "\${GREEN}✓ Proyecto anterior eliminado\${NC}"
    else
        echo -e "\${RED}❌ Error: El proyecto ya existe\${NC}"
        exit 1
    fi
fi

mkdir -p "\$PROJECT_DIR"
cd "\$PROJECT_DIR"
`;
}

function portDetectionBlock(defaultPort: number): string {
  return `
# ============================================
# DETECTAR PUERTOS DISPONIBLES
# ============================================

echo ""
echo -e "\${YELLOW}🔍 Detectando puertos...\${NC}"

find_available_port() {
    local start_port=\$1
    local port=\$start_port
    while [ \$port -lt \$((start_port + 100)) ]; do
        if ! ss -tuln 2>/dev/null | grep -q ":\$port " && \\
           ! docker ps --format '{{.Ports}}' 2>/dev/null | grep -qE "0\\\\.0\\\\.0\\\\.0:\$port->"; then
            echo \$port
            return 0
        fi
        port=\$((port + 1))
    done
    echo \$((start_port + 1000))
}

if [ "\$HAS_DOMAIN" = "true" ]; then
    APP_PORT="traefik"
    echo -e "\${GREEN}✓ Usando Traefik para \$DOMAIN\${NC}"
else
    APP_PORT=\$(find_available_port ${defaultPort})
    echo -e "\${GREEN}✓ Puerto App: \$APP_PORT\${NC}"
fi
`;
}

function subdomainSedBlock(): string {
  return `
# Si es subdominio, quitar la regla www del docker-compose
if [ "\$IS_SUBDOMAIN" = "true" ] && [ "\$HAS_DOMAIN" = "true" ]; then
    sed -i "s/ || Host(\\\`www.\$DOMAIN\\\`)//g" "\$PROJECT_DIR/docker-compose.yml"
    echo -e "\${BLUE}ℹ️  Subdominio detectado: se omitió www.\$DOMAIN\${NC}"
fi
`;
}

function jsonOutputBlock(appLabel: string): string {
  return `
# ============================================
# RESUMEN FINAL
# ============================================

set +e
SERVER_IP=\$(curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || curl -4 -s --connect-timeout 5 ipinfo.io/ip 2>/dev/null || hostname -I | awk '{print \$1}' || echo "localhost")

if [ "\$HAS_DOMAIN" = "true" ]; then
    URL_ACCESS="https://\$DOMAIN"
else
    URL_ACCESS="http://\${SERVER_IP}:\$APP_PORT"
fi
set -e

echo ""
echo -e "\${CYAN}"
echo "============================================"
echo "  ✅ ${appLabel} INSTALADO EXITOSAMENTE"
echo "============================================"
echo -e "\${NC}"
docker compose ps
echo ""
echo -e "\${GREEN}🌐 URL: \$URL_ACCESS\${NC}"

echo "JSON_START"
echo "{"
echo "  \\"project_name\\": \\"\$PROJECT_NAME\\","
echo "  \\"domain\\": \\"\$DOMAIN\\","
echo "  \\"project_type\\": \\"docker-app\\","
echo "  \\"app_name\\": \\"${appLabel}\\","
echo "  \\"url\\": \\"\$URL_ACCESS\\","
echo "  \\"app_port\\": \\"\$APP_PORT\\","
if [ "\$HAS_DOMAIN" = "true" ]; then echo "  \\"ssl\\": \\"traefik\\""; else echo "  \\"ssl\\": \\"none\\""; fi
echo "}"
echo "JSON_END"
`;
}

// ============================================
// N8N
// ============================================
function generateN8nScript(projectName: string, domain: string, hasDomain: boolean, forceOverwrite?: boolean): string {
  return scriptHeader(projectName, 'n8n', domain, hasDomain)
    + traefikSetupBlock()
    + projectCheckBlock(forceOverwrite)
    + portDetectionBlock(5678)
    + `
echo ""
echo -e "\${YELLOW}🐳 Generando docker-compose.yml...\${NC}"

${hasDomain ? `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  n8n:
    image: n8nio/n8n:latest
    container_name: \${PROJECT_NAME}_n8n
    restart: unless-stopped
    environment:
      - N8N_HOST=\$DOMAIN
      - N8N_PORT=5678
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://\$DOMAIN/
      - GENERIC_TIMEZONE=America/Bogota
      - N8N_SECURE_COOKIE=true
    volumes:
      - \${PROJECT_NAME}_n8n_data:/home/node/.n8n
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_network"
      - "traefik.http.routers.\${PROJECT_NAME}-http.rule=Host(\\\\\`\$DOMAIN\\\\\`) || Host(\\\\\`www.\$DOMAIN\\\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-http.entrypoints=web"
      - "traefik.http.routers.\${PROJECT_NAME}-http.middlewares=\${PROJECT_NAME}-redirect-https"
      - "traefik.http.routers.\${PROJECT_NAME}-https.rule=Host(\\\\\`\$DOMAIN\\\\\`) || Host(\\\\\`www.\$DOMAIN\\\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-https.entrypoints=websecure"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls=true"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls.certresolver=letsencrypt"
      - "traefik.http.services.\${PROJECT_NAME}-service.loadbalancer.server.port=5678"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.permanent=true"
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true
volumes:
  \${PROJECT_NAME}_n8n_data:
EOF
` : `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  n8n:
    image: n8nio/n8n:latest
    container_name: \${PROJECT_NAME}_n8n
    restart: unless-stopped
    environment:
      - GENERIC_TIMEZONE=America/Bogota
      - N8N_SECURE_COOKIE=false
    ports:
      - "\$APP_PORT:5678"
    volumes:
      - \${PROJECT_NAME}_n8n_data:/home/node/.n8n
    networks:
      - \${PROJECT_NAME}_network
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
volumes:
  \${PROJECT_NAME}_n8n_data:
EOF
`}
echo -e "\${GREEN}✓ docker-compose.yml creado\${NC}"
`
    + subdomainSedBlock()
    + `
echo ""
echo -e "\${YELLOW}🐳 Levantando contenedores...\${NC}"
cd "\$PROJECT_DIR"
docker compose up -d --remove-orphans
sleep 5
echo -e "\${GREEN}✓ n8n está corriendo\${NC}"
`
    + jsonOutputBlock('n8n');
}

// ============================================
// ODOO
// ============================================
function generateOdooScript(projectName: string, domain: string, hasDomain: boolean, forceOverwrite?: boolean): string {
  return scriptHeader(projectName, 'Odoo', domain, hasDomain)
    + traefikSetupBlock()
    + projectCheckBlock(forceOverwrite)
    + portDetectionBlock(8069)
    + `
echo ""
echo -e "\${YELLOW}🐳 Generando docker-compose.yml...\${NC}"

DB_PASS=\$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-16)

${hasDomain ? `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  odoo:
    image: odoo:17.0
    container_name: \${PROJECT_NAME}_odoo
    restart: unless-stopped
    depends_on:
      - postgres
    environment:
      - HOST=postgres
      - USER=odoo
      - PASSWORD=\$DB_PASS
    volumes:
      - \${PROJECT_NAME}_odoo_data:/var/lib/odoo
      - \${PROJECT_NAME}_odoo_addons:/mnt/extra-addons
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_network"
      - "traefik.http.routers.\${PROJECT_NAME}-http.rule=Host(\\\\\`\$DOMAIN\\\\\`) || Host(\\\\\`www.\$DOMAIN\\\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-http.entrypoints=web"
      - "traefik.http.routers.\${PROJECT_NAME}-http.middlewares=\${PROJECT_NAME}-redirect-https"
      - "traefik.http.routers.\${PROJECT_NAME}-https.rule=Host(\\\\\`\$DOMAIN\\\\\`) || Host(\\\\\`www.\$DOMAIN\\\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-https.entrypoints=websecure"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls=true"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls.certresolver=letsencrypt"
      - "traefik.http.services.\${PROJECT_NAME}-service.loadbalancer.server.port=8069"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.permanent=true"
  postgres:
    image: postgres:15
    container_name: \${PROJECT_NAME}_postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=postgres
      - POSTGRES_PASSWORD=\$DB_PASS
      - POSTGRES_USER=odoo
    volumes:
      - \${PROJECT_NAME}_postgres_data:/var/lib/postgresql/data
    networks:
      - \${PROJECT_NAME}_network
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true
volumes:
  \${PROJECT_NAME}_odoo_data:
  \${PROJECT_NAME}_odoo_addons:
  \${PROJECT_NAME}_postgres_data:
EOF
` : `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  odoo:
    image: odoo:17.0
    container_name: \${PROJECT_NAME}_odoo
    restart: unless-stopped
    depends_on:
      - postgres
    ports:
      - "\$APP_PORT:8069"
    environment:
      - HOST=postgres
      - USER=odoo
      - PASSWORD=\$DB_PASS
    volumes:
      - \${PROJECT_NAME}_odoo_data:/var/lib/odoo
      - \${PROJECT_NAME}_odoo_addons:/mnt/extra-addons
    networks:
      - \${PROJECT_NAME}_network
  postgres:
    image: postgres:15
    container_name: \${PROJECT_NAME}_postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=postgres
      - POSTGRES_PASSWORD=\$DB_PASS
      - POSTGRES_USER=odoo
    volumes:
      - \${PROJECT_NAME}_postgres_data:/var/lib/postgresql/data
    networks:
      - \${PROJECT_NAME}_network
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
volumes:
  \${PROJECT_NAME}_odoo_data:
  \${PROJECT_NAME}_odoo_addons:
  \${PROJECT_NAME}_postgres_data:
EOF
`}
echo -e "\${GREEN}✓ docker-compose.yml creado\${NC}"
`
    + subdomainSedBlock()
    + `
echo ""
echo -e "\${YELLOW}🐳 Levantando contenedores...\${NC}"
cd "\$PROJECT_DIR"
docker compose up -d --remove-orphans
echo -e "\${YELLOW}⏳ Esperando a que Odoo inicie (puede tardar ~30s)...\${NC}"
sleep 30
echo -e "\${GREEN}✓ Odoo está corriendo\${NC}"

# Guardar credenciales
set +e
SERVER_IP=\$(curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || curl -4 -s --connect-timeout 5 ipinfo.io/ip 2>/dev/null || hostname -I | awk '{print \$1}' || echo "localhost")
if [ "\$HAS_DOMAIN" = "true" ]; then URL_ACCESS="https://\$DOMAIN"; else URL_ACCESS="http://\${SERVER_IP}:\$APP_PORT"; fi
{
echo "PROYECTO: \$PROJECT_NAME"
echo "APP: Odoo 17"
echo "URL: \$URL_ACCESS"
echo ""
echo "DATABASE:"
echo "  PostgreSQL User: odoo"
echo "  PostgreSQL Pass: \$DB_PASS"
echo ""
echo "NOTA: El primer acceso te pedirá crear la base de datos de Odoo."
echo "Master Password por defecto: admin"
} > "\$PROJECT_DIR/CREDENCIALES.txt"
chmod 600 "\$PROJECT_DIR/CREDENCIALES.txt"
echo -e "\${GREEN}✓ Credenciales guardadas\${NC}"
set -e

echo ""
echo -e "\${CYAN}"
echo "============================================"
echo "  ✅ Odoo INSTALADO EXITOSAMENTE"
echo "============================================"
echo -e "\${NC}"
docker compose ps
echo ""
echo -e "\${GREEN}🌐 URL: \$URL_ACCESS\${NC}"

echo "JSON_START"
echo "{"
echo "  \\"project_name\\": \\"\$PROJECT_NAME\\","
echo "  \\"domain\\": \\"\$DOMAIN\\","
echo "  \\"project_type\\": \\"docker-app\\","
echo "  \\"app_name\\": \\"Odoo\\","
echo "  \\"url\\": \\"\$URL_ACCESS\\","
echo "  \\"app_port\\": \\"\$APP_PORT\\","
echo "  \\"db_user\\": \\"odoo\\","
echo "  \\"db_pass\\": \\"\$DB_PASS\\","
if [ "\$HAS_DOMAIN" = "true" ]; then echo "  \\"ssl\\": \\"traefik\\""; else echo "  \\"ssl\\": \\"none\\""; fi
echo "}"
echo "JSON_END"
`;
}

// ============================================
// EVOLUTION API
// ============================================
function generateEvolutionScript(projectName: string, domain: string, hasDomain: boolean, forceOverwrite?: boolean): string {
  return scriptHeader(projectName, 'Evolution API', domain, hasDomain)
    + traefikSetupBlock()
    + projectCheckBlock(forceOverwrite)
    + portDetectionBlock(8080)
    + `
echo ""
echo -e "\${YELLOW}🐳 Generando docker-compose.yml...\${NC}"

API_KEY=\$(openssl rand -hex 16)
DB_PASS=\$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-16)

${hasDomain ? `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  evolution:
    image: evoapicloud/evolution-api:v2.3.7
    container_name: \${PROJECT_NAME}_evolution
    restart: unless-stopped
    environment:
      - SERVER_URL=https://\$DOMAIN
      - AUTHENTICATION_API_KEY=\$API_KEY
      - AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
      - DATABASE_PROVIDER=postgresql
      - DATABASE_CONNECTION_URI=postgresql://\${PROJECT_NAME}_user:\$DB_PASS@postgres:5432/\${PROJECT_NAME}_db?schema=public
      - DEL_INSTANCE=false
      - LANGUAGE=es
    volumes:
      - \${PROJECT_NAME}_evolution_instances:/evolution/instances
      - \${PROJECT_NAME}_evolution_store:/evolution/store
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    depends_on:
      - postgres
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_network"
      - "traefik.http.routers.\${PROJECT_NAME}-http.rule=Host(\\\\\`\$DOMAIN\\\\\`) || Host(\\\\\`www.\$DOMAIN\\\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-http.entrypoints=web"
      - "traefik.http.routers.\${PROJECT_NAME}-http.middlewares=\${PROJECT_NAME}-redirect-https"
      - "traefik.http.routers.\${PROJECT_NAME}-https.rule=Host(\\\\\`\$DOMAIN\\\\\`) || Host(\\\\\`www.\$DOMAIN\\\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-https.entrypoints=websecure"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls=true"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls.certresolver=letsencrypt"
      - "traefik.http.services.\${PROJECT_NAME}-service.loadbalancer.server.port=8080"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.permanent=true"
  postgres:
    image: postgres:15-alpine
    container_name: \${PROJECT_NAME}_postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=\${PROJECT_NAME}_db
      - POSTGRES_USER=\${PROJECT_NAME}_user
      - POSTGRES_PASSWORD=\$DB_PASS
    volumes:
      - \${PROJECT_NAME}_postgres_data:/var/lib/postgresql/data
    networks:
      - \${PROJECT_NAME}_network
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true
volumes:
  \${PROJECT_NAME}_evolution_instances:
  \${PROJECT_NAME}_evolution_store:
  \${PROJECT_NAME}_postgres_data:
EOF
` : `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  evolution:
    image: evoapicloud/evolution-api:v2.3.7
    container_name: \${PROJECT_NAME}_evolution
    restart: unless-stopped
    ports:
      - "\$APP_PORT:8080"
    environment:
      - AUTHENTICATION_API_KEY=\$API_KEY
      - AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
      - DATABASE_PROVIDER=postgresql
      - DATABASE_CONNECTION_URI=postgresql://\${PROJECT_NAME}_user:\$DB_PASS@postgres:5432/\${PROJECT_NAME}_db?schema=public
      - DEL_INSTANCE=false
      - LANGUAGE=es
    volumes:
      - \${PROJECT_NAME}_evolution_instances:/evolution/instances
      - \${PROJECT_NAME}_evolution_store:/evolution/store
    networks:
      - \${PROJECT_NAME}_network
    depends_on:
      - postgres
  postgres:
    image: postgres:15-alpine
    container_name: \${PROJECT_NAME}_postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=\${PROJECT_NAME}_db
      - POSTGRES_USER=\${PROJECT_NAME}_user
      - POSTGRES_PASSWORD=\$DB_PASS
    volumes:
      - \${PROJECT_NAME}_postgres_data:/var/lib/postgresql/data
    networks:
      - \${PROJECT_NAME}_network
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
volumes:
  \${PROJECT_NAME}_evolution_instances:
  \${PROJECT_NAME}_evolution_store:
  \${PROJECT_NAME}_postgres_data:
EOF
`}
echo -e "\${GREEN}✓ docker-compose.yml creado\${NC}"
`
    + subdomainSedBlock()
    + `
echo ""
echo -e "\${YELLOW}🐳 Levantando contenedores...\${NC}"
cd "\$PROJECT_DIR"
docker compose up -d --remove-orphans
sleep 10
echo -e "\${GREEN}✓ Evolution API está corriendo\${NC}"

# Guardar credenciales
set +e
SERVER_IP=\$(curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || curl -4 -s --connect-timeout 5 ipinfo.io/ip 2>/dev/null || hostname -I | awk '{print \$1}' || echo "localhost")
if [ "\$HAS_DOMAIN" = "true" ]; then URL_ACCESS="https://\$DOMAIN"; else URL_ACCESS="http://\${SERVER_IP}:\$APP_PORT"; fi
{
echo "PROYECTO: \$PROJECT_NAME"
echo "APP: Evolution API"
echo "URL: \$URL_ACCESS"
echo ""
echo "API KEY: \$API_KEY"
echo ""
echo "DATABASE: PostgreSQL"
echo "DB Name: \${PROJECT_NAME}_db"
echo "DB User: \${PROJECT_NAME}_user"
echo "DB Pass: \$DB_PASS"
echo ""
echo "Documentación: \$URL_ACCESS/docs"
} > "\$PROJECT_DIR/CREDENCIALES.txt"
chmod 600 "\$PROJECT_DIR/CREDENCIALES.txt"
echo -e "\${GREEN}✓ Credenciales guardadas\${NC}"
set -e

echo ""
echo -e "\${CYAN}"
echo "============================================"
echo "  ✅ Evolution API INSTALADO EXITOSAMENTE"
echo "============================================"
echo -e "\${NC}"
docker compose ps
echo ""
echo -e "\${GREEN}🌐 URL: \$URL_ACCESS\${NC}"
echo -e "\${GREEN}🔑 API Key: \$API_KEY\${NC}"

echo "JSON_START"
echo "{"
echo "  \\"project_name\\": \\"\$PROJECT_NAME\\","
echo "  \\"domain\\": \\"\$DOMAIN\\","
echo "  \\"project_type\\": \\"docker-app\\","
echo "  \\"app_name\\": \\"Evolution API\\","
echo "  \\"url\\": \\"\$URL_ACCESS\\","
echo "  \\"app_port\\": \\"\$APP_PORT\\","
echo "  \\"api_key\\": \\"\$API_KEY\\","
if [ "\$HAS_DOMAIN" = "true" ]; then echo "  \\"ssl\\": \\"traefik\\""; else echo "  \\"ssl\\": \\"none\\""; fi
echo "}"
echo "JSON_END"
`;
}

// ============================================
// UPTIME KUMA
// ============================================
function generateUptimeKumaScript(projectName: string, domain: string, hasDomain: boolean, forceOverwrite?: boolean): string {
  return scriptHeader(projectName, 'Uptime Kuma', domain, hasDomain)
    + traefikSetupBlock()
    + projectCheckBlock(forceOverwrite)
    + portDetectionBlock(3001)
    + `
echo ""
echo -e "\${YELLOW}🐳 Generando docker-compose.yml...\${NC}"

${hasDomain ? `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: \${PROJECT_NAME}_kuma
    restart: unless-stopped
    volumes:
      - \${PROJECT_NAME}_kuma_data:/app/data
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_network"
      - "traefik.http.routers.\${PROJECT_NAME}-http.rule=Host(\\\\\`\$DOMAIN\\\\\`) || Host(\\\\\`www.\$DOMAIN\\\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-http.entrypoints=web"
      - "traefik.http.routers.\${PROJECT_NAME}-http.middlewares=\${PROJECT_NAME}-redirect-https"
      - "traefik.http.routers.\${PROJECT_NAME}-https.rule=Host(\\\\\`\$DOMAIN\\\\\`) || Host(\\\\\`www.\$DOMAIN\\\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-https.entrypoints=websecure"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls=true"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls.certresolver=letsencrypt"
      - "traefik.http.services.\${PROJECT_NAME}-service.loadbalancer.server.port=3001"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.permanent=true"
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true
volumes:
  \${PROJECT_NAME}_kuma_data:
EOF
` : `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  uptime-kuma:
    image: louislam/uptime-kuma:1
    container_name: \${PROJECT_NAME}_kuma
    restart: unless-stopped
    ports:
      - "\$APP_PORT:3001"
    volumes:
      - \${PROJECT_NAME}_kuma_data:/app/data
    networks:
      - \${PROJECT_NAME}_network
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
volumes:
  \${PROJECT_NAME}_kuma_data:
EOF
`}
echo -e "\${GREEN}✓ docker-compose.yml creado\${NC}"
`
    + subdomainSedBlock()
    + `
echo ""
echo -e "\${YELLOW}🐳 Levantando contenedores...\${NC}"
cd "\$PROJECT_DIR"
docker compose up -d --remove-orphans
sleep 5
echo -e "\${GREEN}✓ Uptime Kuma está corriendo\${NC}"
`
    + jsonOutputBlock('Uptime Kuma');
}

// ============================================
// PORTAINER
// ============================================
function generatePortainerScript(projectName: string, domain: string, hasDomain: boolean, forceOverwrite?: boolean): string {
  return scriptHeader(projectName, 'Portainer', domain, hasDomain)
    + traefikSetupBlock()
    + projectCheckBlock(forceOverwrite)
    + portDetectionBlock(9000)
    + `
echo ""
echo -e "\${YELLOW}🐳 Generando docker-compose.yml...\${NC}"

${hasDomain ? `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  portainer:
    image: portainer/portainer-ce:latest
    container_name: \${PROJECT_NAME}_portainer
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - \${PROJECT_NAME}_portainer_data:/data
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_network"
      - "traefik.http.routers.\${PROJECT_NAME}-http.rule=Host(\\\\\`\$DOMAIN\\\\\`) || Host(\\\\\`www.\$DOMAIN\\\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-http.entrypoints=web"
      - "traefik.http.routers.\${PROJECT_NAME}-http.middlewares=\${PROJECT_NAME}-redirect-https"
      - "traefik.http.routers.\${PROJECT_NAME}-https.rule=Host(\\\\\`\$DOMAIN\\\\\`) || Host(\\\\\`www.\$DOMAIN\\\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-https.entrypoints=websecure"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls=true"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls.certresolver=letsencrypt"
      - "traefik.http.services.\${PROJECT_NAME}-service.loadbalancer.server.port=9000"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.permanent=true"
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true
volumes:
  \${PROJECT_NAME}_portainer_data:
EOF
` : `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  portainer:
    image: portainer/portainer-ce:latest
    container_name: \${PROJECT_NAME}_portainer
    restart: unless-stopped
    ports:
      - "\$APP_PORT:9000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - \${PROJECT_NAME}_portainer_data:/data
    networks:
      - \${PROJECT_NAME}_network
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
volumes:
  \${PROJECT_NAME}_portainer_data:
EOF
`}
echo -e "\${GREEN}✓ docker-compose.yml creado\${NC}"
`
    + subdomainSedBlock()
    + `
echo ""
echo -e "\${YELLOW}🐳 Levantando contenedores...\${NC}"
cd "\$PROJECT_DIR"
docker compose up -d --remove-orphans
sleep 5
echo -e "\${GREEN}✓ Portainer está corriendo\${NC}"
`
    + jsonOutputBlock('Portainer');
}
