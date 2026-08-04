export type DockerApp = 'n8n' | 'odoo' | 'evolution-api' | 'evolution-go' | 'uptime-kuma' | 'portainer' | 'crowdsec' | 'ntopng' | 'netdata' | 'grafana';

export type DockerAppConfig = {
  appName: DockerApp;
  projectName: string;
  domain: string;
  forceOverwrite?: boolean;
  migrateFromEvoApi?: boolean;
};

export const DOCKER_APPS: Record<DockerApp, { label: string; description: string; icon: string; defaultPort: number; hasDb: boolean }> = {
  'n8n': { label: 'n8n', description: 'Workflow Automation', icon: '🔄', defaultPort: 5678, hasDb: false },
  'odoo': { label: 'Odoo', description: 'ERP & CRM', icon: '📊', defaultPort: 8069, hasDb: true },
  'evolution-api': { label: 'Evolution API', description: 'WhatsApp API', icon: '💬', defaultPort: 8080, hasDb: true },
  'evolution-go': { label: 'Evolution Go', description: 'WhatsApp API (Go)', icon: '🚀', defaultPort: 4000, hasDb: true },
  'uptime-kuma': { label: 'Uptime Kuma', description: 'Server Monitoring', icon: '📡', defaultPort: 3001, hasDb: false },
  'portainer': { label: 'Portainer', description: 'Docker Management', icon: '🐳', defaultPort: 9000, hasDb: false },
  'crowdsec': { label: 'CrowdSec', description: 'Security Engine & Firewall', icon: '🛡️', defaultPort: 8080, hasDb: false },
  'ntopng': { label: 'ntopng', description: 'Network Traffic Monitor', icon: '🌐', defaultPort: 3000, hasDb: false },
  'netdata': { label: 'Netdata', description: 'Monitoreo en Tiempo Real', icon: '📈', defaultPort: 19999, hasDb: false },
  'grafana': { label: 'Grafana + Prometheus', description: 'Métricas y Dashboards Docker', icon: '📊', defaultPort: 3000, hasDb: false },
};

export function generateDockerAppScript(config: DockerAppConfig): string {
  const { appName, projectName, domain, forceOverwrite, migrateFromEvoApi } = config;
  const hasDomain = !!domain && domain !== 'localhost' && domain.trim() !== '';

  switch (appName) {
    case 'n8n': return generateN8nScript(projectName, domain, hasDomain, forceOverwrite);
    case 'odoo': return generateOdooScript(projectName, domain, hasDomain, forceOverwrite);
    case 'evolution-api': return generateEvolutionScript(projectName, domain, hasDomain, forceOverwrite);
    case 'evolution-go': return generateEvolutionGoScript(projectName, domain, hasDomain, forceOverwrite, migrateFromEvoApi);
    case 'uptime-kuma': return generateUptimeKumaScript(projectName, domain, hasDomain, forceOverwrite);
    case 'portainer': return generatePortainerScript(projectName, domain, hasDomain, forceOverwrite);
    case 'crowdsec': return generateCrowdSecScript(projectName, domain, hasDomain, forceOverwrite);
    case 'ntopng': return generateNtopngScript(projectName, domain, hasDomain, forceOverwrite);
    case 'netdata': return generateNetdataScript(projectName, domain, hasDomain, forceOverwrite);
    case 'grafana': return generateGrafanaScript(projectName, domain, hasDomain, forceOverwrite);
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

function traefikSetupBlock(domain: string): string {
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
      email: admin@${domain || 'localhost'}
      storage: /acme.json
      httpChallenge:
        entryPoint: web
TRAEFIK_CONFIG

        cat > "\$TRAEFIK_DIR/docker-compose.yml" <<'DOCKER_COMPOSE'
name: traefik
services:
  traefik:
    image: traefik:v3.6.1
    container_name: traefik
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    ports:
      - "80:80"
      - "443:443"
    environment:
      - DOCKER_API_VERSION=1.41
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
        # Actualizar email ACME si aún tiene el valor incorrecto
        if [ -f "/root/traefik/traefik.yml" ] && grep -q "admin@localhost" "/root/traefik/traefik.yml"; then
            echo -e "\${YELLOW}⚠️  Actualizando email ACME en Traefik...\${NC}"
            sed -i "s/email: admin@localhost/email: admin@\${DOMAIN}/" "/root/traefik/traefik.yml"
            docker restart traefik 2>/dev/null || true
            echo -e "\${GREEN}✓ Email ACME actualizado en Traefik\${NC}"
        fi
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
SERVER_IP=\${DEPLOY_HOST_IP:-\$(hostname -I 2>/dev/null | awk '{print \$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "localhost")}

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
    + traefikSetupBlock(domain)
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
    + traefikSetupBlock(domain)
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
SERVER_IP=\${DEPLOY_HOST_IP:-\$(hostname -I 2>/dev/null | awk '{print \$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "localhost")}
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
    + traefikSetupBlock(domain)
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
      - SERVER_TYPE=https
      - WPP_LID_MODE=false
      - AUTHENTICATION_API_KEY=\$API_KEY
      - AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
      - DATABASE_PROVIDER=postgresql
      - DATABASE_CONNECTION_URI=postgresql://\${PROJECT_NAME}_user:\$DB_PASS@postgres:5432/\${PROJECT_NAME}_db?schema=public
      - DATABASE_CONNECTION_CLIENT_NAME=evolution_crm
      - DATABASE_ENABLED=true
      - DATABASE_SAVE_DATA_INSTANCE=true
      - DATABASE_SAVE_DATA_NEW_MESSAGE=true
      - DATABASE_SAVE_MESSAGE_UPDATE=true
      - DATABASE_SAVE_DATA_CONTACTS=true
      - DATABASE_SAVE_DATA_CHATS=true
      - DATABASE_SAVE_DATA_LABELS=true
      - DATABASE_SAVE_DATA_HISTORIC=true
      - WEBSOCKET_ENABLED=true
      - WEBSOCKET_GLOBAL_EVENTS=true
      - CACHE_REDIS_ENABLED=true
      - CACHE_REDIS_URI=redis://redis:6379/0
      - CACHE_REDIS_PREFIX_KEY=evolution
      - CACHE_REDIS_SAVE_INSTANCES=false
      - CONFIG_SESSION_PHONE_CLIENT=WhatsApp Web
      - CONFIG_SESSION_PHONE_NAME=chrome
      - CONFIG_SESSION_PHONE_VERSION=2.3000.1033105955
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
      - redis
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
  redis:
    image: redis:7-alpine
    container_name: \${PROJECT_NAME}_redis
    restart: unless-stopped
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
      - SERVER_URL=http://\${DEPLOY_HOST_IP:-127.0.0.1}:\$APP_PORT
      - SERVER_TYPE=http
      - WPP_LID_MODE=false
      - AUTHENTICATION_API_KEY=\$API_KEY
      - AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=true
      - DATABASE_PROVIDER=postgresql
      - DATABASE_CONNECTION_URI=postgresql://\${PROJECT_NAME}_user:\$DB_PASS@postgres:5432/\${PROJECT_NAME}_db?schema=public
      - DATABASE_CONNECTION_CLIENT_NAME=evolution_crm
      - DATABASE_ENABLED=true
      - DATABASE_SAVE_DATA_INSTANCE=true
      - DATABASE_SAVE_DATA_NEW_MESSAGE=true
      - DATABASE_SAVE_MESSAGE_UPDATE=true
      - DATABASE_SAVE_DATA_CONTACTS=true
      - DATABASE_SAVE_DATA_CHATS=true
      - DATABASE_SAVE_DATA_LABELS=true
      - DATABASE_SAVE_DATA_HISTORIC=true
      - WEBSOCKET_ENABLED=true
      - WEBSOCKET_GLOBAL_EVENTS=true
      - CACHE_REDIS_ENABLED=true
      - CACHE_REDIS_URI=redis://redis:6379/0
      - CACHE_REDIS_PREFIX_KEY=evolution
      - CACHE_REDIS_SAVE_INSTANCES=false
      - CONFIG_SESSION_PHONE_CLIENT=WhatsApp Web
      - CONFIG_SESSION_PHONE_NAME=chrome
      - CONFIG_SESSION_PHONE_VERSION=2.3000.1033105955
      - DEL_INSTANCE=false
      - LANGUAGE=es
    volumes:
      - \${PROJECT_NAME}_evolution_instances:/evolution/instances
      - \${PROJECT_NAME}_evolution_store:/evolution/store
    networks:
      - \${PROJECT_NAME}_network
    depends_on:
      - postgres
      - redis
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
  redis:
    image: redis:7-alpine
    container_name: \${PROJECT_NAME}_redis
    restart: unless-stopped
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
SERVER_IP=\${DEPLOY_HOST_IP:-\$(hostname -I 2>/dev/null | awk '{print \$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "localhost")}
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
// EVOLUTION GO
// ============================================
function generateEvolutionGoScript(projectName: string, domain: string, hasDomain: boolean, forceOverwrite?: boolean, migrateFromEvoApi?: boolean): string {
  return scriptHeader(projectName, 'Evolution Go', domain, hasDomain)
    + traefikSetupBlock(domain)
    + projectCheckBlock(forceOverwrite)
    + (migrateFromEvoApi ? `
# ============================================
# MIGRAR DESDE EVOLUTION API
# ============================================

echo ""
echo -e "\${YELLOW}🔄 Buscando instancia de Evolution API para migrar...\${NC}"

MIGRATE_FROM=""
MIGRATE_DB_PASS=""
MIGRATE_DB_USER=""
MIGRATE_DB_NAME=""

for dir in /root/proyectos/*/; do
    if [ -f "\$dir/docker-compose.yml" ]; then
        if grep -q "evoapicloud/evolution-api" "\$dir/docker-compose.yml" 2>/dev/null; then
            OLD_PROJECT=\$(basename "\$dir")
            echo -e "\${GREEN}✓ Encontrada Evolution API en: \$OLD_PROJECT\${NC}"
            MIGRATE_FROM="\$dir"

            # Extraer credenciales de la DB existente
            MIGRATE_DB_PASS=\$(grep -oP 'POSTGRES_PASSWORD=\\K[^\\s]+' "\$dir/docker-compose.yml" 2>/dev/null || echo "")
            MIGRATE_DB_USER=\$(grep -oP 'POSTGRES_USER=\\K[^\\s]+' "\$dir/docker-compose.yml" 2>/dev/null || echo "")
            MIGRATE_DB_NAME=\$(grep -oP 'POSTGRES_DB=\\K[^\\s]+' "\$dir/docker-compose.yml" 2>/dev/null || echo "")

            # Detener Evolution API
            echo -e "\${YELLOW}⏹️  Deteniendo Evolution API...\${NC}"
            cd "\$dir"
            docker compose stop evolution 2>/dev/null || true
            echo -e "\${GREEN}✓ Evolution API detenida (base de datos preservada)\${NC}"
            break
        fi
    fi
done

if [ -z "\$MIGRATE_FROM" ]; then
    echo -e "\${YELLOW}⚠️  No se encontró Evolution API para migrar. Instalación limpia.\${NC}"
fi
` : '')
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
  evolution-go:
    image: evoapicloud/evolution-go:latest
    container_name: \${PROJECT_NAME}_evolution_go
    restart: unless-stopped
    environment:
      - SERVER_URL=https://\$DOMAIN
      - SERVER_PORT=4000
      - CLIENT_NAME=evolution
      - GLOBAL_API_KEY=\$API_KEY
      - POSTGRES_AUTH_DB=postgresql://postgres:\$DB_PASS@postgres:5432/\${PROJECT_NAME}_evogo_auth?sslmode=disable
      - POSTGRES_USERS_DB=postgresql://postgres:\$DB_PASS@postgres:5432/\${PROJECT_NAME}_evogo_users?sslmode=disable
      - DATABASE_SAVE_MESSAGES=false
      - WADEBUG=INFO
      - LOGTYPE=console
      - CONNECT_ON_STARTUP=false
      - WEBHOOK_FILES=true
    volumes:
      - \${PROJECT_NAME}_evolution_go_data:/app/dbdata
      - \${PROJECT_NAME}_evolution_go_logs:/app/logs
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
      - "traefik.http.services.\${PROJECT_NAME}-service.loadbalancer.server.port=4000"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.permanent=true"
  postgres:
    image: postgres:15-alpine
    container_name: \${PROJECT_NAME}_postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=postgres
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=\$DB_PASS
    volumes:
      - \${PROJECT_NAME}_postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro
    networks:
      - \${PROJECT_NAME}_network
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true
volumes:
  \${PROJECT_NAME}_evolution_go_data:
  \${PROJECT_NAME}_evolution_go_logs:
  \${PROJECT_NAME}_postgres_data:
EOF
` : `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  evolution-go:
    image: evoapicloud/evolution-go:latest
    container_name: \${PROJECT_NAME}_evolution_go
    restart: unless-stopped
    ports:
      - "\$APP_PORT:4000"
    environment:
      - SERVER_PORT=4000
      - CLIENT_NAME=evolution
      - GLOBAL_API_KEY=\$API_KEY
      - POSTGRES_AUTH_DB=postgresql://postgres:\$DB_PASS@postgres:5432/\${PROJECT_NAME}_evogo_auth?sslmode=disable
      - POSTGRES_USERS_DB=postgresql://postgres:\$DB_PASS@postgres:5432/\${PROJECT_NAME}_evogo_users?sslmode=disable
      - DATABASE_SAVE_MESSAGES=false
      - WADEBUG=INFO
      - LOGTYPE=console
      - CONNECT_ON_STARTUP=false
      - WEBHOOK_FILES=true
    volumes:
      - \${PROJECT_NAME}_evolution_go_data:/app/dbdata
      - \${PROJECT_NAME}_evolution_go_logs:/app/logs
    networks:
      - \${PROJECT_NAME}_network
    depends_on:
      - postgres
  postgres:
    image: postgres:15-alpine
    container_name: \${PROJECT_NAME}_postgres
    restart: unless-stopped
    environment:
      - POSTGRES_DB=postgres
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=\$DB_PASS
    volumes:
      - \${PROJECT_NAME}_postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro
    networks:
      - \${PROJECT_NAME}_network
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
volumes:
  \${PROJECT_NAME}_evolution_go_data:
  \${PROJECT_NAME}_evolution_go_logs:
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
echo -e "\${GREEN}✓ Evolution Go está corriendo\${NC}"

# Guardar credenciales
set +e
SERVER_IP=\${DEPLOY_HOST_IP:-\$(hostname -I 2>/dev/null | awk '{print \$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "localhost")}
if [ "\$HAS_DOMAIN" = "true" ]; then URL_ACCESS="https://\$DOMAIN"; else URL_ACCESS="http://\${SERVER_IP}:\$APP_PORT"; fi
{
echo "PROYECTO: \$PROJECT_NAME"
echo "APP: Evolution Go"
echo "URL: \$URL_ACCESS"
echo ""
echo "API KEY: \$API_KEY"
echo ""
echo "DATABASE: PostgreSQL"
echo "DB Name (Auth): \${PROJECT_NAME}_evogo_auth"
echo "DB Name (Users): \${PROJECT_NAME}_evogo_users"
echo "DB User: postgres"
echo "DB Pass: \$DB_PASS"
echo ""
echo "Health Check: \$URL_ACCESS/server/ok"
echo "Documentación: \$URL_ACCESS/swagger/index.html"
} > "\$PROJECT_DIR/CREDENCIALES.txt"
chmod 600 "\$PROJECT_DIR/CREDENCIALES.txt"
echo -e "\${GREEN}✓ Credenciales guardadas\${NC}"
set -e

echo ""
echo -e "\${CYAN}"
echo "============================================"
echo "  ✅ Evolution Go INSTALADO EXITOSAMENTE"
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
echo "  \\"app_name\\": \\"Evolution Go\\","
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
    + traefikSetupBlock(domain)
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
    + traefikSetupBlock(domain)
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

// ============================================
// CROWDSEC
// ============================================
function generateCrowdSecScript(projectName: string, domain: string, hasDomain: boolean, forceOverwrite?: boolean): string {
  return scriptHeader(projectName, 'CrowdSec', domain, hasDomain)
    + traefikSetupBlock(domain)
    + projectCheckBlock(forceOverwrite)
    + portDetectionBlock(8080)
    + `
echo ""
echo -e "\${YELLOW}🐳 Generando configuración de CrowdSec...\${NC}"

BOUNCER_KEY=\$(openssl rand -hex 16)

# Crear directorio de configuración de acquis
mkdir -p "\$PROJECT_DIR/acquis"

# Configuración de adquisición para logs de Traefik
cat > "\$PROJECT_DIR/acquis/traefik.yaml" <<'ACQUIS_TRAEFIK'
source: docker
docker_host: unix:///var/run/docker.sock
container_name_regexp:
  - "^traefik$"
labels:
  type: traefik
ACQUIS_TRAEFIK

# Configuración de adquisición para logs del sistema
cat > "\$PROJECT_DIR/acquis/syslog.yaml" <<'ACQUIS_SYSLOG'
filenames:
  - /var/log/syslog
  - /var/log/auth.log
labels:
  type: syslog
ACQUIS_SYSLOG

${hasDomain ? `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  crowdsec:
    image: crowdsecurity/crowdsec:latest
    container_name: \${PROJECT_NAME}_crowdsec
    restart: unless-stopped
    environment:
      - COLLECTIONS=crowdsecurity/linux crowdsecurity/traefik crowdsecurity/http-cve crowdsecurity/whitelist-good-actors crowdsecurity/iptables
      - BOUNCER_KEY_traefik=\$BOUNCER_KEY
      - GID=\$(getent group docker | cut -d: -f3 || echo 999)
    volumes:
      - \${PROJECT_NAME}_crowdsec_config:/etc/crowdsec
      - \${PROJECT_NAME}_crowdsec_data:/var/lib/crowdsec/data
      - /var/log:/var/log:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./acquis/traefik.yaml:/etc/crowdsec/acquis.d/traefik.yaml:ro
      - ./acquis/syslog.yaml:/etc/crowdsec/acquis.d/syslog.yaml:ro
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network

  bouncer-traefik:
    image: fbonalair/traefik-crowdsec-bouncer:latest
    container_name: \${PROJECT_NAME}_bouncer
    restart: unless-stopped
    depends_on:
      - crowdsec
    environment:
      - CROWDSEC_BOUNCER_API_KEY=\$BOUNCER_KEY
      - CROWDSEC_AGENT_HOST=\${PROJECT_NAME}_crowdsec:8080
      - GIN_MODE=release
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_network"
      - "traefik.http.services.\${PROJECT_NAME}-bouncer.loadbalancer.server.port=8080"

networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true
volumes:
  \${PROJECT_NAME}_crowdsec_config:
  \${PROJECT_NAME}_crowdsec_data:
EOF
` : `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  crowdsec:
    image: crowdsecurity/crowdsec:latest
    container_name: \${PROJECT_NAME}_crowdsec
    restart: unless-stopped
    environment:
      - COLLECTIONS=crowdsecurity/linux crowdsecurity/traefik crowdsecurity/http-cve crowdsecurity/whitelist-good-actors crowdsecurity/iptables
      - BOUNCER_KEY_traefik=\$BOUNCER_KEY
      - GID=\$(getent group docker | cut -d: -f3 || echo 999)
    ports:
      - "\$APP_PORT:8080"
    volumes:
      - \${PROJECT_NAME}_crowdsec_config:/etc/crowdsec
      - \${PROJECT_NAME}_crowdsec_data:/var/lib/crowdsec/data
      - /var/log:/var/log:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./acquis/traefik.yaml:/etc/crowdsec/acquis.d/traefik.yaml:ro
      - ./acquis/syslog.yaml:/etc/crowdsec/acquis.d/syslog.yaml:ro
    networks:
      - \${PROJECT_NAME}_network

networks:
  \${PROJECT_NAME}_network:
    driver: bridge
volumes:
  \${PROJECT_NAME}_crowdsec_config:
  \${PROJECT_NAME}_crowdsec_data:
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
echo -e "\${YELLOW}⏳ Esperando a que CrowdSec inicie y descargue colecciones (~30s)...\${NC}"
sleep 30
echo -e "\${GREEN}✓ CrowdSec está corriendo\${NC}"

# Configurar middleware de CrowdSec en Traefik si hay dominio
if [ "\$HAS_DOMAIN" = "true" ]; then
    TRAEFIK_DIR="/root/traefik"
    
    # Agregar middleware de CrowdSec al traefik.yml si no existe
    if ! grep -q "crowdsec" "\$TRAEFIK_DIR/traefik.yml" 2>/dev/null; then
        cat >> "\$TRAEFIK_DIR/traefik.yml" <<CROWDSEC_MIDDLEWARE
http:
  middlewares:
    crowdsec:
      forwardAuth:
        address: "http://\${PROJECT_NAME}_bouncer:8080/api/v1/forwardAuth"
        trustForwardHeader: true
CROWDSEC_MIDDLEWARE
        echo -e "\${GREEN}✓ Middleware CrowdSec configurado en Traefik\${NC}"
        
        # Reiniciar Traefik para aplicar cambios
        cd "\$TRAEFIK_DIR"
        docker compose restart
        sleep 5
        cd "\$PROJECT_DIR"
        echo -e "\${GREEN}✓ Traefik reiniciado con CrowdSec\${NC}"
    else
        echo -e "\${GREEN}✓ CrowdSec ya estaba configurado en Traefik\${NC}"
    fi
fi

# Verificar estado
echo ""
echo -e "\${YELLOW}🔍 Verificando estado de CrowdSec...\${NC}"
docker exec \${PROJECT_NAME}_crowdsec cscli hub list 2>/dev/null || echo "Hub list pendiente..."
docker exec \${PROJECT_NAME}_crowdsec cscli bouncers list 2>/dev/null || echo "Bouncers pendiente..."

# Guardar credenciales
set +e
SERVER_IP=\${DEPLOY_HOST_IP:-\$(hostname -I 2>/dev/null | awk '{print \$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "localhost")}
if [ "\$HAS_DOMAIN" = "true" ]; then URL_ACCESS="https://\$DOMAIN"; else URL_ACCESS="http://\${SERVER_IP}:\$APP_PORT"; fi
{
echo "PROYECTO: \$PROJECT_NAME"
echo "APP: CrowdSec Security Engine"
echo ""
echo "BOUNCER API KEY: \$BOUNCER_KEY"
echo ""
echo "COMANDOS ÚTILES:"
echo "  Ver decisiones activas: docker exec \${PROJECT_NAME}_crowdsec cscli decisions list"
echo "  Ver alertas: docker exec \${PROJECT_NAME}_crowdsec cscli alerts list"
echo "  Banear IP manual: docker exec \${PROJECT_NAME}_crowdsec cscli decisions add --ip <IP> --duration 24h --reason 'manual ban'"
echo "  Desbanear IP: docker exec \${PROJECT_NAME}_crowdsec cscli decisions delete --ip <IP>"
echo "  Ver bouncers: docker exec \${PROJECT_NAME}_crowdsec cscli bouncers list"
echo "  Ver colecciones: docker exec \${PROJECT_NAME}_crowdsec cscli hub list"
echo "  Ver métricas: docker exec \${PROJECT_NAME}_crowdsec cscli metrics"
} > "\$PROJECT_DIR/CREDENCIALES.txt"
chmod 600 "\$PROJECT_DIR/CREDENCIALES.txt"
echo -e "\${GREEN}✓ Credenciales y comandos guardados\${NC}"
set -e

echo ""
echo -e "\${CYAN}"
echo "============================================"
echo "  ✅ CrowdSec INSTALADO EXITOSAMENTE"
echo "============================================"
echo -e "\${NC}"
docker compose ps
echo ""
if [ "\$HAS_DOMAIN" = "true" ]; then
    echo -e "\${GREEN}🛡️  CrowdSec protegiendo tráfico via Traefik\${NC}"
    echo -e "\${YELLOW}ℹ️  Para proteger un servicio, añade el middleware crowdsec a sus labels de Traefik:\${NC}"
    echo -e "\${BLUE}   traefik.http.routers.NOMBRE-https.middlewares=crowdsec\${NC}"
else
    echo -e "\${GREEN}🌐 API: \$URL_ACCESS\${NC}"
fi
echo -e "\${GREEN}🔑 Bouncer Key: \$BOUNCER_KEY\${NC}"

echo "JSON_START"
echo "{"
echo "  \\"project_name\\": \\"\$PROJECT_NAME\\","
echo "  \\"domain\\": \\"\$DOMAIN\\","
echo "  \\"project_type\\": \\"docker-app\\","
echo "  \\"app_name\\": \\"CrowdSec\\","
echo "  \\"url\\": \\"\$URL_ACCESS\\","
echo "  \\"app_port\\": \\"\$APP_PORT\\","
echo "  \\"bouncer_key\\": \\"\$BOUNCER_KEY\\","
if [ "\$HAS_DOMAIN" = "true" ]; then echo "  \\"ssl\\": \\"traefik\\""; else echo "  \\"ssl\\": \\"none\\""; fi
echo "}"
echo "JSON_END"
`;
}

// ============================================
// NTOPNG
// ============================================
function generateNtopngScript(projectName: string, domain: string, hasDomain: boolean, forceOverwrite?: boolean): string {
  return scriptHeader(projectName, 'ntopng', domain, hasDomain)
    + traefikSetupBlock(domain)
    + projectCheckBlock(forceOverwrite)
    + portDetectionBlock(3000)
    + `
echo ""
echo -e "\${YELLOW}🐳 Generando configuración de ntopng...\${NC}"

NTOPNG_PASS=\$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-16)

${hasDomain ? `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  ntopng:
    image: ntop/ntopng:stable
    container_name: \${PROJECT_NAME}_ntopng
    restart: unless-stopped
    environment:
      - TZ=America/Bogota
    volumes:
      - \${PROJECT_NAME}_ntopng_data:/var/lib/ntopng
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    cap_add:
      - NET_ADMIN
      - SYS_PTRACE
    command: --community -d /var/lib/ntopng -i eth0 -w 0.0.0.0:3000 --http-prefix=/
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
      - "traefik.http.services.\${PROJECT_NAME}-service.loadbalancer.server.port=3000"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.permanent=true"

  redis:
    image: redis:7-alpine
    container_name: \${PROJECT_NAME}_redis
    restart: unless-stopped
    volumes:
      - \${PROJECT_NAME}_redis_data:/data
    networks:
      - \${PROJECT_NAME}_network

networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true
volumes:
  \${PROJECT_NAME}_ntopng_data:
  \${PROJECT_NAME}_redis_data:
EOF
` : `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  ntopng:
    image: ntop/ntopng:stable
    container_name: \${PROJECT_NAME}_ntopng
    restart: unless-stopped
    environment:
      - TZ=America/Bogota
    ports:
      - "\$APP_PORT:3000"
    volumes:
      - \${PROJECT_NAME}_ntopng_data:/var/lib/ntopng
    networks:
      - \${PROJECT_NAME}_network
    cap_add:
      - NET_ADMIN
      - SYS_PTRACE
    command: --community -d /var/lib/ntopng -i eth0 -w 0.0.0.0:3000

  redis:
    image: redis:7-alpine
    container_name: \${PROJECT_NAME}_redis
    restart: unless-stopped
    volumes:
      - \${PROJECT_NAME}_redis_data:/data
    networks:
      - \${PROJECT_NAME}_network

networks:
  \${PROJECT_NAME}_network:
    driver: bridge
volumes:
  \${PROJECT_NAME}_ntopng_data:
  \${PROJECT_NAME}_redis_data:
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
echo -e "\${YELLOW}⏳ Esperando a que ntopng inicie (~15s)...\${NC}"
sleep 15
echo -e "\${GREEN}✓ ntopng está corriendo\${NC}"

# Guardar credenciales
set +e
SERVER_IP=\${DEPLOY_HOST_IP:-\$(hostname -I 2>/dev/null | awk '{print \$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "localhost")}
if [ "\$HAS_DOMAIN" = "true" ]; then URL_ACCESS="https://\$DOMAIN"; else URL_ACCESS="http://\${SERVER_IP}:\$APP_PORT"; fi
{
echo "PROYECTO: \$PROJECT_NAME"
echo "APP: ntopng - Network Traffic Monitor"
echo "URL: \$URL_ACCESS"
echo ""
echo "CREDENCIALES POR DEFECTO:"
echo "  Usuario: admin"
echo "  Password: admin (cambiar en el primer acceso)"
echo ""
echo "NOTAS:"
echo "  - ntopng monitorea el tráfico de red en tiempo real"
echo "  - Interfaz web con gráficos de flujo, hosts, protocolos"
echo "  - Redis se usa como cache para mejor rendimiento"
} > "\$PROJECT_DIR/CREDENCIALES.txt"
chmod 600 "\$PROJECT_DIR/CREDENCIALES.txt"
echo -e "\${GREEN}✓ Credenciales guardadas\${NC}"
set -e

echo ""
echo -e "\${CYAN}"
echo "============================================"
echo "  ✅ ntopng INSTALADO EXITOSAMENTE"
echo "============================================"
echo -e "\${NC}"
docker compose ps
echo ""
echo -e "\${GREEN}🌐 URL: \$URL_ACCESS\${NC}"
echo -e "\${YELLOW}👤 Usuario: admin | Password: admin\${NC}"
echo -e "\${YELLOW}⚠️  Cambia la contraseña en el primer acceso\${NC}"

echo "JSON_START"
echo "{"
echo "  \\"project_name\\": \\"\$PROJECT_NAME\\","
echo "  \\"domain\\": \\"\$DOMAIN\\","
echo "  \\"project_type\\": \\"docker-app\\","
echo "  \\"app_name\\": \\"ntopng\\","
echo "  \\"url\\": \\"\$URL_ACCESS\\","
echo "  \\"app_port\\": \\"\$APP_PORT\\","
echo "  \\"default_user\\": \\"admin\\","
echo "  \\"default_pass\\": \\"admin\\","
if [ "\$HAS_DOMAIN" = "true" ]; then echo "  \\"ssl\\": \\"traefik\\""; else echo "  \\"ssl\\": \\"none\\""; fi
echo "}"
echo "JSON_END"
`;
}

// ============================================
// NETDATA
// ============================================
function generateNetdataScript(projectName: string, domain: string, hasDomain: boolean, forceOverwrite?: boolean): string {
  return scriptHeader(projectName, 'Netdata', domain, hasDomain)
    + traefikSetupBlock(domain)
    + projectCheckBlock(forceOverwrite)
    + portDetectionBlock(19999)
    + `
echo ""
echo -e "\${YELLOW}🐳 Generando docker-compose.yml para Netdata...\${NC}"

${hasDomain ? `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  netdata:
    image: netdata/netdata:latest
    container_name: \${PROJECT_NAME}_netdata
    restart: unless-stopped
    pid: host
    cap_add:
      - SYS_PTRACE
      - SYS_ADMIN
    security_opt:
      - apparmor:unconfined
    environment:
      - NETDATA_CLAIM_TOKEN=
      - NETDATA_CLAIM_URL=
      - TZ=America/Bogota
    volumes:
      - \${PROJECT_NAME}_netdata_config:/etc/netdata
      - \${PROJECT_NAME}_netdata_lib:/var/lib/netdata
      - \${PROJECT_NAME}_netdata_cache:/var/cache/netdata
      - /etc/passwd:/host/etc/passwd:ro
      - /etc/group:/host/etc/group:ro
      - /etc/localtime:/etc/localtime:ro
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /etc/os-release:/host/etc/os-release:ro
      - /var/log:/host/var/log:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
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
      - "traefik.http.services.\${PROJECT_NAME}-service.loadbalancer.server.port=19999"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.permanent=true"
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true
volumes:
  \${PROJECT_NAME}_netdata_config:
  \${PROJECT_NAME}_netdata_lib:
  \${PROJECT_NAME}_netdata_cache:
EOF
` : `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  netdata:
    image: netdata/netdata:latest
    container_name: \${PROJECT_NAME}_netdata
    restart: unless-stopped
    pid: host
    cap_add:
      - SYS_PTRACE
      - SYS_ADMIN
    security_opt:
      - apparmor:unconfined
    ports:
      - "\$APP_PORT:19999"
    environment:
      - TZ=America/Bogota
    volumes:
      - \${PROJECT_NAME}_netdata_config:/etc/netdata
      - \${PROJECT_NAME}_netdata_lib:/var/lib/netdata
      - \${PROJECT_NAME}_netdata_cache:/var/cache/netdata
      - /etc/passwd:/host/etc/passwd:ro
      - /etc/group:/host/etc/group:ro
      - /etc/localtime:/etc/localtime:ro
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /etc/os-release:/host/etc/os-release:ro
      - /var/log:/host/var/log:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - \${PROJECT_NAME}_network
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
volumes:
  \${PROJECT_NAME}_netdata_config:
  \${PROJECT_NAME}_netdata_lib:
  \${PROJECT_NAME}_netdata_cache:
EOF
`}
echo -e "\${GREEN}✓ docker-compose.yml creado\${NC}"
`
    + subdomainSedBlock()
    + `
echo ""
echo -e "\${YELLOW}🐳 Levantando Netdata...\${NC}"
cd "\$PROJECT_DIR"
docker compose up -d --remove-orphans
echo -e "\${YELLOW}⏳ Esperando que Netdata inicie (~10s)...\${NC}"
sleep 10
echo -e "\${GREEN}✓ Netdata está corriendo\${NC}"

set +e
SERVER_IP=\${DEPLOY_HOST_IP:-\$(hostname -I 2>/dev/null | awk '{print \$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "localhost")}
if [ "\$HAS_DOMAIN" = "true" ]; then URL_ACCESS="https://\$DOMAIN"; else URL_ACCESS="http://\${SERVER_IP}:\$APP_PORT"; fi

{
echo "PROYECTO: \$PROJECT_NAME"
echo "APP: Netdata - Real-time Performance Monitoring"
echo "URL: \$URL_ACCESS"
echo ""
echo "NOTA: No requiere login por defecto."
echo "Para proteger con contraseña edita: /etc/netdata/netdata.conf"
} > "\$PROJECT_DIR/CREDENCIALES.txt"
chmod 600 "\$PROJECT_DIR/CREDENCIALES.txt"
set -e

echo ""
echo -e "\${CYAN}"
echo "============================================"
echo "  ✅ Netdata INSTALADO EXITOSAMENTE"
echo "============================================"
echo -e "\${NC}"
docker compose ps
echo ""
echo -e "\${GREEN}🌐 URL: \$URL_ACCESS\${NC}"
echo -e "\${YELLOW}📊 Monitorea CPU, RAM, Disco, Red y cada contenedor Docker en tiempo real\${NC}"
echo -e "\${YELLOW}⏱️  Historial de hasta 1 año con anomaly detection automático\${NC}"

echo "JSON_START"
echo "{"
echo "  \\"project_name\\": \\"\$PROJECT_NAME\\","
echo "  \\"domain\\": \\"\$DOMAIN\\","
echo "  \\"project_type\\": \\"docker-app\\","
echo "  \\"app_name\\": \\"Netdata\\","
echo "  \\"url\\": \\"\$URL_ACCESS\\","
echo "  \\"app_port\\": \\"\$APP_PORT\\","
if [ "\$HAS_DOMAIN" = "true" ]; then echo "  \\"ssl\\": \\"traefik\\""; else echo "  \\"ssl\\": \\"none\\""; fi
echo "}"
echo "JSON_END"
`;
}

// ============================================
// GRAFANA + PROMETHEUS + cADVISOR + NODE EXPORTER
// ============================================
function generateGrafanaScript(projectName: string, domain: string, hasDomain: boolean, forceOverwrite?: boolean): string {
  return scriptHeader(projectName, 'Grafana + Prometheus', domain, hasDomain)
    + traefikSetupBlock(domain)
    + projectCheckBlock(forceOverwrite)
    + portDetectionBlock(3000)
    + `
echo ""
echo -e "\${YELLOW}🐳 Configurando stack de monitoreo completo (todo automático)...\${NC}"
echo -e "\${CYAN}  Componentes: Grafana · Prometheus · cAdvisor · Node Exporter\${NC}"

GRAFANA_PASS=\$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-16)

# ── Crear estructura de directorios ──────────────────────────────
mkdir -p "\$PROJECT_DIR/prometheus"
mkdir -p "\$PROJECT_DIR/grafana/provisioning/datasources"
mkdir -p "\$PROJECT_DIR/grafana/provisioning/dashboards"
mkdir -p "\$PROJECT_DIR/grafana/dashboards"

# ── prometheus.yml ───────────────────────────────────────────────
cat > "\$PROJECT_DIR/prometheus/prometheus.yml" <<'PROMEOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'cadvisor'
    scrape_interval: 5s
    static_configs:
      - targets: ['cadvisor:8080']

  - job_name: 'node-exporter'
    scrape_interval: 10s
    static_configs:
      - targets: ['node-exporter:9100']
PROMEOF
echo -e "\${GREEN}  ✓ prometheus.yml\${NC}"

# ── Grafana: datasource Prometheus ───────────────────────────────
cat > "\$PROJECT_DIR/grafana/provisioning/datasources/prometheus.yml" <<'DSEOF'
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
DSEOF
echo -e "\${GREEN}  ✓ datasource configurado\${NC}"

# ── Grafana: provisioning de dashboards desde disco ──────────────
cat > "\$PROJECT_DIR/grafana/provisioning/dashboards/default.yml" <<'DBEOF'
apiVersion: 1
providers:
  - name: auto
    folder: 'Servidor'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 30
    options:
      path: /var/lib/grafana/dashboards
DBEOF
echo -e "\${GREEN}  ✓ provisioning configurado\${NC}"

${hasDomain ? `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  grafana:
    image: grafana/grafana:latest
    container_name: \${PROJECT_NAME}_grafana
    restart: unless-stopped
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=\$GRAFANA_PASS
      - GF_USERS_ALLOW_SIGN_UP=false
      - GF_SERVER_ROOT_URL=https://\$DOMAIN
      - GF_AUTH_ANONYMOUS_ENABLED=false
      - TZ=America/Bogota
    volumes:
      - \${PROJECT_NAME}_grafana_data:/var/lib/grafana
      - \$PROJECT_DIR/grafana/provisioning:/etc/grafana/provisioning
      - \$PROJECT_DIR/grafana/dashboards:/var/lib/grafana/dashboards
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    depends_on:
      - prometheus
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
      - "traefik.http.services.\${PROJECT_NAME}-service.loadbalancer.server.port=3000"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.permanent=true"

  prometheus:
    image: prom/prometheus:latest
    container_name: \${PROJECT_NAME}_prometheus
    restart: unless-stopped
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
      - '--web.enable-lifecycle'
    volumes:
      - \$PROJECT_DIR/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - \${PROJECT_NAME}_prometheus_data:/prometheus
    networks:
      - \${PROJECT_NAME}_network

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    container_name: \${PROJECT_NAME}_cadvisor
    restart: unless-stopped
    privileged: true
    devices:
      - /dev/kmsg
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro
    networks:
      - \${PROJECT_NAME}_network

  node-exporter:
    image: prom/node-exporter:latest
    container_name: \${PROJECT_NAME}_node_exporter
    restart: unless-stopped
    pid: host
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.rootfs=/rootfs'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)(\\$\\$|/)'
    networks:
      - \${PROJECT_NAME}_network

networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true
volumes:
  \${PROJECT_NAME}_grafana_data:
  \${PROJECT_NAME}_prometheus_data:
EOF
` : `
cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  grafana:
    image: grafana/grafana:latest
    container_name: \${PROJECT_NAME}_grafana
    restart: unless-stopped
    ports:
      - "\$APP_PORT:3000"
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=\$GRAFANA_PASS
      - GF_USERS_ALLOW_SIGN_UP=false
      - GF_AUTH_ANONYMOUS_ENABLED=false
      - TZ=America/Bogota
    volumes:
      - \${PROJECT_NAME}_grafana_data:/var/lib/grafana
      - \$PROJECT_DIR/grafana/provisioning:/etc/grafana/provisioning
      - \$PROJECT_DIR/grafana/dashboards:/var/lib/grafana/dashboards
    networks:
      - \${PROJECT_NAME}_network
    depends_on:
      - prometheus

  prometheus:
    image: prom/prometheus:latest
    container_name: \${PROJECT_NAME}_prometheus
    restart: unless-stopped
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
      - '--web.enable-lifecycle'
    volumes:
      - \$PROJECT_DIR/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - \${PROJECT_NAME}_prometheus_data:/prometheus
    networks:
      - \${PROJECT_NAME}_network

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    container_name: \${PROJECT_NAME}_cadvisor
    restart: unless-stopped
    privileged: true
    devices:
      - /dev/kmsg
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker:/var/lib/docker:ro
      - /dev/disk/:/dev/disk:ro
    networks:
      - \${PROJECT_NAME}_network

  node-exporter:
    image: prom/node-exporter:latest
    container_name: \${PROJECT_NAME}_node_exporter
    restart: unless-stopped
    pid: host
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.rootfs=/rootfs'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)(\\$\\$|/)'
    networks:
      - \${PROJECT_NAME}_network

networks:
  \${PROJECT_NAME}_network:
    driver: bridge
volumes:
  \${PROJECT_NAME}_grafana_data:
  \${PROJECT_NAME}_prometheus_data:
EOF
`}
echo -e "\${GREEN}✓ docker-compose.yml creado\${NC}"
`
    + subdomainSedBlock()
    + `
echo ""
echo -e "\${YELLOW}🐳 Levantando stack de monitoreo...\${NC}"
cd "\$PROJECT_DIR"
docker compose up -d --remove-orphans

# ── Esperar a que Grafana esté saludable (hasta 90s) ─────────────
echo -e "\${YELLOW}⏳ Esperando que Grafana inicie...\${NC}"
GRAFANA_READY=false
for i in \$(seq 1 30); do
    GRAFANA_IP=\$(docker inspect --format='{{range \$k, \$v := .NetworkSettings.Networks}}{{\$v.IPAddress}} {{end}}' \${PROJECT_NAME}_grafana 2>/dev/null | awk '{print \$1}')
    if [ -n "\$GRAFANA_IP" ]; then
        HTTP_CODE=\$(curl -s -o /dev/null -w "%{http_code}" "http://\$GRAFANA_IP:3000/api/health" 2>/dev/null || echo "000")
        if [ "\$HTTP_CODE" = "200" ]; then
            GRAFANA_READY=true
            echo -e "\${GREEN}✓ Grafana listo en \$((i * 3))s\${NC}"
            break
        fi
    fi
    sleep 3
done

# ── Importar dashboards automáticamente ──────────────────────────
import_dashboard() {
    local DASH_ID=\$1
    local DASH_NAME=\$2
    local DASH_FILE=\$3
    echo -e "\${YELLOW}  → \$DASH_NAME (ID: \$DASH_ID)\${NC}"
    DASH_JSON=\$(curl -sf --connect-timeout 10 "https://grafana.com/api/dashboards/\${DASH_ID}/revisions/latest/download" 2>/dev/null)
    if [ -n "\$DASH_JSON" ] && echo "\$DASH_JSON" | grep -q '"title"'; then
        # Guardar en disco para que persista tras reinicios (provisioning)
        echo "\$DASH_JSON" > "\$PROJECT_DIR/grafana/dashboards/\${DASH_FILE}.json"
        # Importar via API para disponibilidad inmediata
        RESULT=\$(curl -s -X POST \
            -H "Content-Type: application/json" \
            -u "admin:\$GRAFANA_PASS" \
            "http://\$GRAFANA_IP:3000/api/dashboards/import" \
            -d "{\"dashboard\":\$DASH_JSON,\"overwrite\":true,\"folderId\":0,\"inputs\":[{\"name\":\"DS_PROMETHEUS\",\"type\":\"datasource\",\"pluginId\":\"prometheus\",\"value\":\"Prometheus\"}]}" 2>/dev/null)
        if echo "\$RESULT" | grep -q '"status":"success"'; then
            echo -e "\${GREEN}    ✓ importado\${NC}"
        else
            echo -e "\${YELLOW}    ✓ guardado (disponible tras reinicio)\${NC}"
        fi
    else
        echo -e "\${YELLOW}    ⚠ Sin acceso a grafana.com — dashboard omitido\${NC}"
    fi
}

if [ "\$GRAFANA_READY" = "true" ]; then
    echo ""
    echo -e "\${YELLOW}📊 Importando dashboards...\${NC}"
    import_dashboard 1860  "Node Exporter Full (CPU/RAM/Disco/Red del servidor)" "node-exporter-full"
    import_dashboard 14282 "Docker cAdvisor (métricas por contenedor)"           "cadvisor-docker"
    import_dashboard 11600 "Docker Containers (vista general)"                   "docker-containers"
    echo -e "\${GREEN}✓ Dashboards listos\${NC}"
else
    echo -e "\${YELLOW}⚠ Grafana tardó — los dashboards se cargarán al reiniciar (provisioning automático)\${NC}"
fi

set +e
SERVER_IP=\${DEPLOY_HOST_IP:-\$(hostname -I 2>/dev/null | awk '{print \$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || echo "localhost")}
if [ "\$HAS_DOMAIN" = "true" ]; then URL_ACCESS="https://\$DOMAIN"; else URL_ACCESS="http://\${SERVER_IP}:\$APP_PORT"; fi

{
echo "PROYECTO: \$PROJECT_NAME"
echo "APP: Grafana + Prometheus + cAdvisor + Node Exporter"
echo ""
echo "URL: \$URL_ACCESS"
echo "USUARIO: admin"
echo "CONTRASEÑA: \$GRAFANA_PASS"
echo ""
echo "DASHBOARDS INSTALADOS:"
echo "  - Node Exporter Full (ID 1860)  → CPU, RAM, Disco, Red del servidor"
echo "  - Docker cAdvisor   (ID 14282)  → Métricas individuales por contenedor"
echo "  - Docker Containers (ID 11600)  → Vista general de todos los contenedores"
echo ""
echo "USO DE RECURSOS (estimado):"
echo "  RAM total: ~350-450 MB"
echo "  CPU: picos <5% cada 15s (scraping Prometheus)"
echo "  Disco: historial de 30 días de métricas en Prometheus"
} > "\$PROJECT_DIR/CREDENCIALES.txt"
chmod 600 "\$PROJECT_DIR/CREDENCIALES.txt"
echo -e "\${GREEN}✓ Credenciales guardadas en CREDENCIALES.txt\${NC}"
set -e

echo ""
echo -e "\${CYAN}"
echo "============================================"
echo "  ✅ Stack de Monitoreo LISTO"
echo "============================================"
echo -e "\${NC}"
docker compose ps
echo ""
echo -e "\${GREEN}🌐 URL: \$URL_ACCESS\${NC}"
echo -e "\${YELLOW}👤 admin | \$GRAFANA_PASS\${NC}"
echo ""
echo -e "\${CYAN}📊 Dashboards pre-instalados (entras y ya ves todo):\${NC}"
echo -e "  • CPU, RAM, Disco, Red del servidor en tiempo real"
echo -e "  • Métricas de cada contenedor Docker"
echo -e "  • Vista general de todos los contenedores"
echo ""
echo -e "\${YELLOW}⚡ Impacto en servidor: ~400MB RAM | CPU <5% en picos de 15s\${NC}"
echo -e "\${YELLOW}   Los scrapes de Prometheus son ligeros y no afectan tus apps\${NC}"

echo "JSON_START"
echo "{"
echo "  \\"project_name\\": \\"\$PROJECT_NAME\\","
echo "  \\"domain\\": \\"\$DOMAIN\\","
echo "  \\"project_type\\": \\"docker-app\\","
echo "  \\"app_name\\": \\"Grafana + Prometheus\\","
echo "  \\"url\\": \\"\$URL_ACCESS\\","
echo "  \\"app_port\\": \\"\$APP_PORT\\","
echo "  \\"app_password\\": \\"\$GRAFANA_PASS\\","
if [ "\$HAS_DOMAIN" = "true" ]; then echo "  \\"ssl\\": \\"traefik\\""; else echo "  \\"ssl\\": \\"none\\""; fi
echo "}"
echo "JSON_END"
`;
}

