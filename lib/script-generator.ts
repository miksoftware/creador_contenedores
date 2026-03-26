export type ProjectConfig = {
  projectName: string;
  domain: string;
  type: 'php' | 'laravel';
  phpVersion: '7.3' | '8.3';
  forceOverwrite?: boolean;
  gitRepoUrl?: string; // URL HTTPS del repositorio Git
  gitBranch?: string; // Rama del repositorio (main, master, develop, etc.)
  sqlFileContent?: string; // Contenido del archivo SQL a importar (solo para PHP 7.3)
  dbName?: string;
  dbUser?: string;
  dbPass?: string;
  dbRootPass?: string;
  withRedis?: boolean; // Incluir Redis (solo para Laravel 8.3)
  withNodeBuild?: boolean; // Compilar assets con Node.js (solo para Laravel 8.3)
};

export function generateSetupScript(config: ProjectConfig): string {
  const { projectName, domain, type, phpVersion, forceOverwrite, gitRepoUrl, sqlFileContent } = config;

  const hasDomain = !!domain && domain !== 'localhost' && domain.trim() !== '';
  const hasGitRepo = !!gitRepoUrl && gitRepoUrl.trim() !== '';
  const hasSqlFile = !!sqlFileContent && sqlFileContent.trim() !== '';
  const mysqlVersion = '8.0';

  // Para PHP 7.3, usar la configuración específica basada en archivos_7.3
  if (phpVersion === '7.3') {
    return generatePHP73Script(config, hasDomain, hasGitRepo, hasSqlFile);
  }

  // PHP 8.3 - Script original
  return generatePHP83Script(config, hasDomain);
}

function generatePHP73Script(config: ProjectConfig, hasDomain: boolean, hasGitRepo: boolean, hasSqlFile: boolean): string {
  const { projectName, domain, forceOverwrite, gitRepoUrl, sqlFileContent } = config;
  
  // Codificar el contenido SQL en base64 para transferirlo de forma segura
  const base64SqlContent = hasSqlFile ? Buffer.from(sqlFileContent!).toString('base64') : '';
  
  return `#!/bin/bash

# ============================================
# Generador Automático de Proyectos PHP 7.3
# Con soporte para Traefik (multi-dominio SSL)
# ============================================

set -e

# Configuración Inyectada
PROJECT_NAME="${projectName}"
DOMAIN="${domain || ''}"
HAS_DOMAIN="${hasDomain}"
FORCE_OVERWRITE="${forceOverwrite ? 'true' : 'false'}"
GIT_REPO_URL="${gitRepoUrl || ''}"
HAS_GIT_REPO="${hasGitRepo}"
HAS_SQL_FILE="${hasSqlFile}"

# Colores
GREEN='\\033[0;32m'
RED='\\033[0;31m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
CYAN='\\033[0;36m'
NC='\\033[0m'

echo -e "\${CYAN}"
echo "============================================"
echo "  🚀 Iniciando Despliegue: \$PROJECT_NAME"
echo "  ✨ PHP 7.3 | MySQL 8.0"
if [ "\$HAS_DOMAIN" = "true" ]; then
    echo "  🌐 Dominio: \$DOMAIN (con Traefik + SSL)"
fi
if [ "\$HAS_GIT_REPO" = "true" ]; then
    echo "  📦 Repositorio: \$GIT_REPO_URL"
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

# Detectar si es subdominio (ej: mikpos.miksoftwarecol.com)
# Si tiene más de 2 partes separadas por punto, es subdominio y no se agrega www
DOMAIN_PARTS=\$(echo "\$DOMAIN" | tr '.' '\\n' | wc -l)
if [ "\$DOMAIN_PARTS" -gt 2 ]; then
    IS_SUBDOMAIN="true"
else
    IS_SUBDOMAIN="false"
fi

# Configuración de base de datos
DB_NAME="\${PROJECT_NAME}_db"
DB_USER="\${PROJECT_NAME}_user"
DB_PASS=\$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-16)
DB_ROOT_PASS="root123"

# ============================================
# VERIFICAR/INSTALAR TRAEFIK SI HAY DOMINIO
# ============================================

if [ "\$HAS_DOMAIN" = "true" ]; then
    echo ""
    echo -e "\${YELLOW}🔍 Verificando Traefik (proxy reverso)...\${NC}"
    
    if ! docker ps | grep -q "traefik"; then
        echo -e "\${YELLOW}📦 Traefik no encontrado. Instalando...\${NC}"
        
        echo -e "\${YELLOW}🔍 Buscando contenedores usando puertos 80/443...\${NC}"
        
        for container in \$(docker ps --format '{{.Names}}'); do
            ports=\$(docker port "\$container" 2>/dev/null | grep -E "(^80/|:80\$|^443/|:443\$)" || true)
            if [ -n "\$ports" ]; then
                echo -e "\${YELLOW}⚠️  Contenedor '\$container' está usando puertos 80/443\${NC}"
                docker stop "\$container" 2>/dev/null || true
                echo -e "\${GREEN}✓ Contenedor '\$container' detenido\${NC}"
            fi
        done

        if ss -tuln 2>/dev/null | grep -qE ":80\\s|:443\\s"; then
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
            echo -e "\${GREEN}✓ Traefik instalado y corriendo\${NC}"
        else
            echo -e "\${RED}❌ Error instalando Traefik\${NC}"
            exit 1
        fi
    else
        echo -e "\${GREEN}✓ Traefik ya está corriendo\${NC}"
        docker network create traefik_network 2>/dev/null || true
    fi
fi

# ============================================
# VERIFICAR PROYECTO EXISTENTE
# ============================================

PROJECT_DIR="/root/proyectos/\${PROJECT_NAME}"

if [ -d "\$PROJECT_DIR" ]; then
    if [ "\$FORCE_OVERWRITE" = "true" ]; then
        echo -e "\${YELLOW}⚠️  Proyecto existente detectado. Eliminando...\${NC}"
        
        cd "\$PROJECT_DIR" 2>/dev/null || true
        docker compose down -v --remove-orphans 2>/dev/null || true
        docker rm -f \${PROJECT_NAME}_php \${PROJECT_NAME}_mysql \${PROJECT_NAME}_nginx 2>/dev/null || true
        docker volume rm \${PROJECT_NAME}_mysql_data 2>/dev/null || true
        docker network rm \${PROJECT_NAME}_network 2>/dev/null || true
        rm -rf "\$PROJECT_DIR"
        
        echo -e "\${GREEN}✓ Proyecto anterior eliminado completamente\${NC}"
    else
        echo -e "\${RED}❌ Error: El proyecto '\$PROJECT_NAME' ya existe en \$PROJECT_DIR\${NC}"
        echo -e "\${YELLOW}💡 Tip: Activa 'Sobrescribir proyecto existente' para reinstalar\${NC}"
        exit 1
    fi
fi

# ============================================
# DETECTAR PUERTOS DISPONIBLES
# ============================================

echo ""
echo -e "\${YELLOW}🔍 Detectando puertos disponibles...\${NC}"

find_available_port() {
    local start_port=\$1
    local port=\$start_port
    local max_attempts=100
    local attempts=0
    
    while [ \$attempts -lt \$max_attempts ]; do
        if ! ss -tuln 2>/dev/null | grep -q ":\$port " && \\
           ! docker ps --format '{{.Ports}}' 2>/dev/null | grep -qE "0\\.0\\.0\\.0:\$port->"; then
            echo \$port
            return 0
        fi
        port=\$((port + 1))
        attempts=\$((attempts + 1))
    done
    
    echo \$((start_port + 1000 + RANDOM % 1000))
}

if [ "\$HAS_DOMAIN" = "true" ]; then
    NGINX_PORT="traefik"
    echo -e "\${GREEN}✓ Usando Traefik para \$DOMAIN (SSL automático)\${NC}"
else
    NGINX_PORT=\$(find_available_port 8001)
    echo -e "\${GREEN}✓ Puerto HTTP: \$NGINX_PORT\${NC}"
fi

MYSQL_PORT=\$(find_available_port 3307)
echo -e "\${GREEN}✓ Puerto MySQL: \$MYSQL_PORT\${NC}"

# ============================================
# CREAR ESTRUCTURA DEL PROYECTO
# ============================================

echo ""
echo -e "\${YELLOW}📁 Creando estructura del proyecto...\${NC}"

mkdir -p "\$PROJECT_DIR"/{public,php-config,backups}

echo -e "\${GREEN}✓ Estructura creada en: \$PROJECT_DIR\${NC}"

# ============================================
# CLONAR REPOSITORIO GIT (si se proporcionó)
# ============================================

if [ "\$HAS_GIT_REPO" = "true" ]; then
    echo ""
    echo -e "\${YELLOW}📦 Clonando repositorio Git...\${NC}"
    echo -e "\${BLUE}    URL: \$GIT_REPO_URL\${NC}"
    
    cd "\$PROJECT_DIR"
    
    # Clonar directamente en public
    if git clone "\$GIT_REPO_URL" public; then
        echo -e "\${GREEN}✓ Repositorio clonado exitosamente en public/\${NC}"
        
        # Mostrar información del último commit
        cd public
        LAST_COMMIT=\$(git log -1 --pretty=format:'%h - %s (%ar) por %an' 2>/dev/null || echo "N/A")
        echo -e "\${BLUE}    📝 Último commit: \$LAST_COMMIT\${NC}"
        cd ..
    else
        echo -e "\${RED}❌ Error al clonar el repositorio\${NC}"
        echo -e "\${YELLOW}💡 Verifica que la URL sea correcta y accesible\${NC}"
        exit 1
    fi
fi

# ============================================
# CREAR Dockerfile PHP 7.3
# ============================================

echo ""
echo -e "\${YELLOW}🐳 Generando Dockerfile PHP 7.3...\${NC}"

cat > "\$PROJECT_DIR/Dockerfile" <<'DOCKERFILE_PHP73'
FROM php:7.3-fpm

RUN docker-php-ext-install mysqli pdo pdo_mysql opcache

RUN echo "session.save_handler = files" >> /usr/local/etc/php/php.ini && \\
    echo "session.save_path = /tmp" >> /usr/local/etc/php/php.ini && \\
    echo "upload_max_filesize = 500M" >> /usr/local/etc/php/php.ini && \\
    echo "post_max_size = 500M" >> /usr/local/etc/php/php.ini && \\
    echo "memory_limit = 512M" >> /usr/local/etc/php/php.ini

RUN chmod 1777 /tmp
DOCKERFILE_PHP73

echo -e "\${GREEN}✓ Dockerfile creado\${NC}"

# ============================================
# CREAR docker-compose.yml (estilo archivos_7.3)
# ============================================

echo ""
echo -e "\${YELLOW}🐳 Generando docker-compose.yml...\${NC}"

if [ "\$HAS_DOMAIN" = "true" ]; then
    cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}

services:
  php:
    build: .
    container_name: \${PROJECT_NAME}_php
    working_dir: /var/www/html
    volumes:
      - ./public:/var/www/html
      - ./php-config/custom.ini:/usr/local/etc/php/conf.d/custom.ini
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    restart: unless-stopped
    depends_on:
      - mysql

  mysql:
    image: mysql:8.0
    container_name: \${PROJECT_NAME}_mysql
    restart: unless-stopped
    command:
      - --default-authentication-plugin=mysql_native_password
      - --performance-schema=OFF
      - --innodb-buffer-pool-size=64M
      - --max-connections=50
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASS}
      MYSQL_DATABASE: \${DB_NAME}
      MYSQL_USER: \${DB_USER}
      MYSQL_PASSWORD: \${DB_PASS}
    volumes:
      - \${PROJECT_NAME}_mysql_data:/var/lib/mysql
    ports:
      - "\${MYSQL_PORT}:3306"
    networks:
      - \${PROJECT_NAME}_network

  nginx:
    image: nginx:alpine
    container_name: \${PROJECT_NAME}_nginx
    restart: unless-stopped
    volumes:
      - ./public:/var/www/html
      - ./nginx-traefik.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - php
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_network"
      - "traefik.http.routers.\${PROJECT_NAME}-http.rule=Host(\\\`\$DOMAIN\\\`) || Host(\\\`www.\$DOMAIN\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-http.entrypoints=web"
      - "traefik.http.routers.\${PROJECT_NAME}-http.middlewares=\${PROJECT_NAME}-redirect-https"
      - "traefik.http.routers.\${PROJECT_NAME}-https.rule=Host(\\\`\$DOMAIN\\\`) || Host(\\\`www.\$DOMAIN\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-https.entrypoints=websecure"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls=true"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls.certresolver=letsencrypt"
      - "traefik.http.services.\${PROJECT_NAME}-service.loadbalancer.server.port=80"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.permanent=true"

networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true

volumes:
  \${PROJECT_NAME}_mysql_data:
EOF
else
    cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}

services:
  php:
    build: .
    container_name: \${PROJECT_NAME}_php
    working_dir: /var/www/html
    volumes:
      - ./public:/var/www/html
      - ./php-config/custom.ini:/usr/local/etc/php/conf.d/custom.ini
    networks:
      - \${PROJECT_NAME}_network
    restart: unless-stopped
    depends_on:
      - mysql

  mysql:
    image: mysql:8.0
    container_name: \${PROJECT_NAME}_mysql
    restart: unless-stopped
    command:
      - --default-authentication-plugin=mysql_native_password
      - --performance-schema=OFF
      - --innodb-buffer-pool-size=64M
      - --max-connections=50
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASS}
      MYSQL_DATABASE: \${DB_NAME}
      MYSQL_USER: \${DB_USER}
      MYSQL_PASSWORD: \${DB_PASS}
    volumes:
      - \${PROJECT_NAME}_mysql_data:/var/lib/mysql
    ports:
      - "\${MYSQL_PORT}:3306"
    networks:
      - \${PROJECT_NAME}_network

  nginx:
    image: nginx:alpine
    container_name: \${PROJECT_NAME}_nginx
    restart: unless-stopped
    ports:
      - "\${NGINX_PORT}:80"
    volumes:
      - ./public:/var/www/html
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - php
    networks:
      - \${PROJECT_NAME}_network

networks:
  \${PROJECT_NAME}_network:
    driver: bridge

volumes:
  \${PROJECT_NAME}_mysql_data:
EOF
fi

# Si es subdominio, quitar la regla www del docker-compose
if [ "\$IS_SUBDOMAIN" = "true" ] && [ "\$HAS_DOMAIN" = "true" ]; then
    sed -i "s/ || Host(\`www.\$DOMAIN\`)//g" "\$PROJECT_DIR/docker-compose.yml"
    echo -e "\${BLUE}ℹ️  Subdominio detectado: se omitió www.\$DOMAIN\${NC}"
fi

echo -e "\${GREEN}✓ docker-compose.yml creado\${NC}"

# ============================================
# CREAR nginx.conf / nginx-traefik.conf (estilo archivos_7.3)
# ============================================

echo ""
echo -e "\${YELLOW}🌐 Generando configuración Nginx...\${NC}"

if [ "\$HAS_DOMAIN" = "true" ]; then
    cat > "\$PROJECT_DIR/nginx-traefik.conf" <<'NGINX_TRAEFIK'
server {
    listen 80;
    server_name _;
    root /var/www/html;
    index index.php index.html;

    # Límites
    client_max_body_size 500M;
    client_body_timeout 600s;
    client_header_timeout 600s;

    # Logs
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    # Remover trailing slashes
    rewrite ^/(.*)/$ /$1 permanent;

    location / {
        try_files $uri $uri/ @rewrite;
    }

    location @rewrite {
        if (-f $request_filename.html) {
            rewrite ^(.+)$ $1.html last;
        }
        if (-f $request_filename.php) {
            rewrite ^(.+)$ $1.php last;
        }
        return 404;
    }

    location ~ \\.php$ {
        try_files $uri =404;
        fastcgi_split_path_info ^(.+\\.php)(/.+)$;
        fastcgi_pass php:9000;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param QUERY_STRING $query_string;
        include fastcgi_params;
        fastcgi_read_timeout 600;
        fastcgi_send_timeout 600;
        fastcgi_buffers 16 16k;
        fastcgi_buffer_size 32k;
    }

    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location ~ /\\. {
        deny all;
    }
}
NGINX_TRAEFIK
    echo -e "\${GREEN}✓ nginx-traefik.conf creado\${NC}"
else
    cat > "\$PROJECT_DIR/nginx.conf" <<'NGINX_CONF'
server {
    listen 80;
    server_name _;
    root /var/www/html;
    index index.php index.html;

    client_max_body_size 500M;
    client_body_timeout 600s;
    client_header_timeout 600s;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    rewrite ^/(.*)/$ /$1 permanent;

    location / {
        try_files $uri $uri/ @rewrite;
    }

    location @rewrite {
        if (-f $request_filename.html) {
            rewrite ^(.+)$ $1.html last;
        }
        if (-f $request_filename.php) {
            rewrite ^(.+)$ $1.php last;
        }
        return 404;
    }

    location ~ \\.php$ {
        try_files $uri =404;
        fastcgi_split_path_info ^(.+\\.php)(/.+)$;
        fastcgi_pass php:9000;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param QUERY_STRING $query_string;
        include fastcgi_params;
        fastcgi_read_timeout 600;
        fastcgi_send_timeout 600;
        fastcgi_buffers 16 16k;
        fastcgi_buffer_size 32k;
    }

    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location ~ /\\. {
        deny all;
    }
}
NGINX_CONF
    echo -e "\${GREEN}✓ nginx.conf creado\${NC}"
fi

# ============================================
# CONFIGURAR PHP
# ============================================

echo ""
echo -e "\${YELLOW}⚙️  Generando configuración PHP...\${NC}"

cat > "\$PROJECT_DIR/php-config/custom.ini" <<'PHP_INI'
session.save_handler = files
session.save_path = "/tmp"
upload_max_filesize = 500M
post_max_size = 500M
memory_limit = 512M
max_execution_time = 600
display_errors = Off
log_errors = On
PHP_INI

echo -e "\${GREEN}✓ Configuración PHP creada\${NC}"

# ============================================
# CREAR ARCHIVO DE PRUEBA (solo si no hay repo)
# ============================================

if [ "\$HAS_GIT_REPO" != "true" ]; then
    echo ""
    echo -e "\${YELLOW}📄 Creando archivo de prueba...\${NC}"

    cat > "\$PROJECT_DIR/public/index.php" <<PHPTEST
<?php
echo "<h1 style='color: #4CAF50;'>✅ Proyecto: \$PROJECT_NAME</h1>";
echo "<h2>PHP 7.3</h2>";
echo "<p><strong>PHP Version:</strong> " . phpversion() . "</p>";
echo "<p><strong>Dominio:</strong> \${DOMAIN:-Sin dominio}</p>";

\\$host = "mysql";
\\$dbname = "\$DB_NAME";
\\$username = "\$DB_USER";
\\$password = "\$DB_PASS";

echo "<h2>Prueba de Conexión a MySQL</h2>";

try {
    \\$conn = new mysqli(\\$host, \\$username, \\$password, \\$dbname);
    
    if (\\$conn->connect_error) {
        echo "<p style='color:red;'>❌ Error: " . \\$conn->connect_error . "</p>";
    } else {
        echo "<p style='color:green;'><strong>✅ Conexión exitosa a MySQL</strong></p>";
        \\$conn->close();
    }
} catch (Exception \\$e) {
    echo "<p style='color:red;'>❌ Error: " . \\$e->getMessage() . "</p>";
}
?>
PHPTEST

    echo -e "\${GREEN}✓ Archivo de prueba creado\${NC}"
fi

# ============================================
# CREAR deploy.sh (script de actualización)
# ============================================

if [ "\$HAS_GIT_REPO" = "true" ]; then
    echo ""
    echo -e "\${YELLOW}📜 Creando script deploy.sh...\${NC}"

    cat > "\$PROJECT_DIR/deploy.sh" <<DEPLOY_SCRIPT
#!/bin/bash

# ============================================
# Script de Deploy Automático
# Proyecto: \$PROJECT_NAME
# Repositorio: \$GIT_REPO_URL
# Uso: bash deploy.sh o: cd /root/proyectos/\$PROJECT_NAME && ./deploy.sh
# ============================================

echo "=========================================="
echo "  🚀 Deploy \$PROJECT_NAME"
echo "  📦 Repo: \$GIT_REPO_URL"
echo "=========================================="
echo ""

GREEN='\\033[0;32m'
RED='\\033[0;31m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m'

PROJECT_DIR="/root/proyectos/\$PROJECT_NAME"
PUBLIC_DIR="\\\$PROJECT_DIR/public"

cd \\\$PUBLIC_DIR

echo -e "\\\${BLUE}📁 Directorio: \\\$(pwd)\\\${NC}"
echo ""

echo -e "\\\${YELLOW}[1/6] 💾 Guardando cambios locales...\\\${NC}"
git stash --quiet 2>/dev/null || true
echo -e "\\\${GREEN}✓ Cambios locales guardados\\\${NC}"

echo ""
echo -e "\\\${YELLOW}[2/6] ⬇️  Descargando cambios desde GitHub...\\\${NC}"

if git pull origin main 2>/dev/null; then
    BRANCH="main"
    echo -e "\\\${GREEN}✓ Cambios descargados desde rama 'main'\\\${NC}"
elif git pull origin master 2>/dev/null; then
    BRANCH="master"
    echo -e "\\\${GREEN}✓ Cambios descargados desde rama 'master'\\\${NC}"
else
    echo -e "\\\${RED}✗ Error al descargar cambios\\\${NC}"
    exit 1
fi

LAST_COMMIT=\\\$(git log -1 --pretty=format:'%h - %s (%ar) por %an')
echo -e "\\\${BLUE}    📝 Último commit: \\\$LAST_COMMIT\\\${NC}"

echo ""
echo -e "\\\${YELLOW}[3/6] 🔄 Restaurando configuración local...\\\${NC}"
git stash pop --quiet 2>/dev/null || true
echo -e "\\\${GREEN}✓ Configuración restaurada\\\${NC}"

echo ""
echo -e "\\\${YELLOW}[4/6] 🔐 Ajustando permisos...\\\${NC}"
chown -R www-data:www-data \\\$PUBLIC_DIR
find \\\$PUBLIC_DIR -type d -exec chmod 755 {} \\; 2>/dev/null
find \\\$PUBLIC_DIR -type f -exec chmod 644 {} \\; 2>/dev/null
echo -e "\\\${GREEN}✓ Permisos ajustados\\\${NC}"

echo ""
echo -e "\\\${YELLOW}[5/6] 🧹 Limpiando caché...\\\${NC}"
docker exec \${PROJECT_NAME}_php find /tmp -name "sess_*" -mtime +1 -delete 2>/dev/null || true
echo -e "\\\${GREEN}✓ Caché limpiado\\\${NC}"

echo ""
echo -e "\\\${YELLOW}[6/6] 🔄 Reiniciando servicios...\\\${NC}"
cd \\\$PROJECT_DIR
docker compose restart php nginx --quiet
sleep 3
echo -e "\\\${GREEN}✓ Servicios reiniciados\\\${NC}"

echo ""
echo -e "\\\${GREEN}=========================================="
echo "  ✅ Deploy completado exitosamente"
echo "==========================================\\\${NC}"
echo ""
echo -e "\\\${BLUE}🌐 URL: \${HAS_DOMAIN:+https://\$DOMAIN}\${HAS_DOMAIN:-http://\$(hostname -I | awk '{print \$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null):\$NGINX_PORT}\\\${NC}"
echo -e "\\\${BLUE}📅 Fecha: \\\$(date '+%Y-%m-%d %H:%M:%S')\\\${NC}"
echo -e "\\\${BLUE}🔀 Rama: \\\$BRANCH\\\${NC}"
echo ""
DEPLOY_SCRIPT

    chmod +x "\$PROJECT_DIR/deploy.sh"
    echo -e "\${GREEN}✓ deploy.sh creado en \$PROJECT_DIR/deploy.sh\${NC}"
fi

# ============================================
# LEVANTAR SERVICIOS
# ============================================

echo ""
echo -e "\${YELLOW}🐳 Construyendo y levantando contenedores...\${NC}"

cd "\$PROJECT_DIR"
docker compose up -d --build --remove-orphans

echo ""
echo -e "\${YELLOW}⏳ Esperando a MySQL...\${NC}"
sleep 20

echo -e "\${YELLOW}🔧 Configurando autenticación MySQL...\${NC}"
docker exec \${PROJECT_NAME}_mysql mysql -uroot -p\${DB_ROOT_PASS} -e "ALTER USER '\${DB_USER}'@'%' IDENTIFIED WITH mysql_native_password BY '\${DB_PASS}'; FLUSH PRIVILEGES;" 2>/dev/null || true
echo -e "\${GREEN}✓ MySQL configurado\${NC}"

# ============================================
# IMPORTAR ARCHIVO SQL (si se proporcionó)
# ============================================

if [ "\$HAS_SQL_FILE" = "true" ]; then
    echo ""
    echo -e "\${YELLOW}📥 Importando archivo SQL a la base de datos...\${NC}"
    
    # Decodificar el SQL desde base64
    echo "${base64SqlContent}" | base64 -d > "\$PROJECT_DIR/import.sql"
    
    # Convertir collations de MariaDB a MySQL
    sed -i 's/utf8mb3_uca1400_ai_ci/utf8mb3_general_ci/g' "\$PROJECT_DIR/import.sql"
    sed -i 's/utf8mb4_uca1400_ai_ci/utf8mb4_general_ci/g' "\$PROJECT_DIR/import.sql"
    sed -i 's/utf8mb3_unicode_ci/utf8mb3_general_ci/g' "\$PROJECT_DIR/import.sql"
    
    # Importar el SQL
    if docker exec -i \${PROJECT_NAME}_mysql mysql -u\${DB_USER} -p\${DB_PASS} \${DB_NAME} < "\$PROJECT_DIR/import.sql"; then
        echo -e "\${GREEN}✓ Base de datos importada exitosamente\${NC}"
        rm -f "\$PROJECT_DIR/import.sql"
    else
        echo -e "\${RED}⚠️  Error al importar SQL, pero el proyecto continúa...\${NC}"
        echo -e "\${YELLOW}   El archivo SQL se guardó en: \$PROJECT_DIR/import.sql\${NC}"
        echo -e "\${YELLOW}   Puedes importar manualmente: docker exec -i \${PROJECT_NAME}_mysql mysql -u\${DB_USER} -p\${DB_PASS} \${DB_NAME} < \$PROJECT_DIR/import.sql\${NC}"
    fi
fi

# Ajustar permisos si hay repo clonado
if [ "\$HAS_GIT_REPO" = "true" ]; then
    echo -e "\${YELLOW}🔐 Ajustando permisos del proyecto...\${NC}"
    chown -R www-data:www-data "\$PROJECT_DIR/public"
    find "\$PROJECT_DIR/public" -type d -exec chmod 755 {} \\; 2>/dev/null
    find "\$PROJECT_DIR/public" -type f -exec chmod 644 {} \\; 2>/dev/null
    echo -e "\${GREEN}✓ Permisos ajustados\${NC}"
fi

echo -e "\${GREEN}✅ Contenedores levantados\${NC}"

# ============================================
# GUARDAR CREDENCIALES
# ============================================

echo ""
echo -e "\${YELLOW}💾 Guardando credenciales...\${NC}"

SERVER_IP=\$(hostname -I | awk '{print \$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || curl -4 -s --connect-timeout 5 ipinfo.io/ip 2>/dev/null || echo "localhost")

if [ "\$HAS_DOMAIN" = "true" ]; then
    URL_ACCESS="https://\$DOMAIN"
    SSL_STATUS="Gestionado por Traefik (Let's Encrypt)"
else
    URL_ACCESS="http://\${SERVER_IP}:\$NGINX_PORT"
    SSL_STATUS="No configurado"
fi

cat > "\$PROJECT_DIR/CREDENCIALES.txt" <<CREDS
============================================
  PROYECTO: \$PROJECT_NAME
============================================

URL: \$URL_ACCESS

DATABASE:
  Host (interno): mysql
  Host (externo): \$SERVER_IP
  Puerto: \$MYSQL_PORT
  Database: \$DB_NAME
  User: \$DB_USER
  Password: \$DB_PASS
  Root Password: \$DB_ROOT_PASS

PUERTOS:
  HTTP: \$NGINX_PORT
  MySQL: \$MYSQL_PORT

SSL: \$SSL_STATUS
CREDS

if [ "\$HAS_GIT_REPO" = "true" ]; then
    cat >> "\$PROJECT_DIR/CREDENCIALES.txt" <<CREDS_GIT

REPOSITORIO GIT:
  URL: \$GIT_REPO_URL
  Deploy Script: \$PROJECT_DIR/deploy.sh
  
Para actualizar el proyecto:
  cd \$PROJECT_DIR && ./deploy.sh
CREDS_GIT
fi

chmod 600 "\$PROJECT_DIR/CREDENCIALES.txt"

echo -e "\${GREEN}✓ Credenciales guardadas en \$PROJECT_DIR/CREDENCIALES.txt\${NC}"

# ============================================
# RESUMEN FINAL
# ============================================

echo ""
echo -e "\${CYAN}"
echo "============================================"
echo "  ✅ PROYECTO CREADO EXITOSAMENTE"
echo "============================================"
echo -e "\${NC}"

docker compose ps

echo ""
if [ "\$HAS_DOMAIN" = "true" ]; then
    echo -e "\${GREEN}🌐 URL: https://\$DOMAIN\${NC}"
    echo -e "\${GREEN}🔒 SSL: Certificado Let's Encrypt (automático via Traefik)\${NC}"
else
    echo -e "\${GREEN}🌐 URL: http://\$SERVER_IP:\$NGINX_PORT\${NC}"
fi

if [ "\$HAS_GIT_REPO" = "true" ]; then
    echo -e "\${GREEN}📦 Repositorio: \$GIT_REPO_URL\${NC}"
    echo -e "\${GREEN}📜 Deploy script: \$PROJECT_DIR/deploy.sh\${NC}"
fi

# ============================================
# OUTPUT CREDENTIALS (JSON for parsing)
# ============================================
echo "JSON_START"
echo "{"
echo "  \\"project_name\\": \\"\$PROJECT_NAME\\","
echo "  \\"domain\\": \\"\$DOMAIN\\","
echo "  \\"project_type\\": \\"php\\","
echo "  \\"php_version\\": \\"7.3\\","
echo "  \\"url\\": \\"\$URL_ACCESS\\","
echo "  \\"db_host\\": \\"\$SERVER_IP\\","
echo "  \\"db_port\\": \\"\$MYSQL_PORT\\","
echo "  \\"db_name\\": \\"\$DB_NAME\\","
echo "  \\"db_user\\": \\"\$DB_USER\\","
echo "  \\"db_pass\\": \\"\$DB_PASS\\","
echo "  \\"nginx_port\\": \\"\$NGINX_PORT\\","
if [ "\$HAS_DOMAIN" = "true" ]; then echo "  \\"ssl\\": \\"traefik\\","; else echo "  \\"ssl\\": \\"none\\","; fi
echo "  \\"git_repo\\": \\"\$GIT_REPO_URL\\","
if [ "\$HAS_GIT_REPO" = "true" ]; then echo "  \\"deploy_script\\": \\"\$PROJECT_DIR/deploy.sh\\""; else echo "  \\"deploy_script\\": \\"none\\""; fi
echo "}"
echo "JSON_END"

`;
}

function generatePHP83Script(config: ProjectConfig, hasDomain: boolean): string {
  const { projectName, domain, type, forceOverwrite, gitRepoUrl, gitBranch, withRedis, withNodeBuild } = config;
  const mysqlVersion = '8.0';
  const hasGitRepo = !!gitRepoUrl && gitRepoUrl.trim() !== '';
  const branch = gitBranch?.trim() || 'main';
  const isLaravel = type === 'laravel';
  const useRedis = isLaravel && withRedis;
  const useNodeBuild = isLaravel && withNodeBuild;

  return `#!/bin/bash

# ============================================
# Generador Automático de Proyectos PHP/Laravel con Docker
# PHP 8.3 - Con soporte para Traefik (multi-dominio SSL)
# ============================================

set -e

PROJECT_NAME="${projectName}"
DOMAIN="${domain || ''}"
PROJECT_TYPE="${type}"
PHP_VERSION="8.3"
MYSQL_VERSION="${mysqlVersion}"
HAS_DOMAIN="${hasDomain}"
FORCE_OVERWRITE="${forceOverwrite ? 'true' : 'false'}"
GIT_REPO_URL="${gitRepoUrl || ''}"
GIT_BRANCH="${branch}"
HAS_GIT_REPO="${hasGitRepo}"
IS_LARAVEL="${isLaravel}"
USE_REDIS="${useRedis}"
USE_NODE_BUILD="${useNodeBuild}"

GREEN='\\033[0;32m'
RED='\\033[0;31m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
CYAN='\\033[0;36m'
NC='\\033[0m'

echo -e "\${CYAN}"
echo "============================================"
echo "  🚀 Iniciando Despliegue: \$PROJECT_NAME"
echo "  ✨ Tipo: \$PROJECT_TYPE | PHP: \$PHP_VERSION"
if [ "\$HAS_DOMAIN" = "true" ]; then
    echo "  🌐 Dominio: \$DOMAIN (con Traefik + SSL)"
fi
if [ "\$HAS_GIT_REPO" = "true" ]; then
    echo "  📦 Repositorio: \$GIT_REPO_URL"
    echo "  🔀 Rama: \$GIT_BRANCH"
fi
if [ "\$USE_REDIS" = "true" ]; then
    echo "  🔴 Redis: Incluido"
fi
if [ "\$USE_NODE_BUILD" = "true" ]; then
    echo "  📦 Node.js: Assets se compilarán"
fi
echo "============================================"
echo -e "\${NC}"

DB_NAME="\${PROJECT_NAME}_db"
DB_USER="\${PROJECT_NAME}_user"
DB_PASS=\$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-16)
DB_ROOT_PASS="root123"

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

# Detectar si es subdominio (ej: mikpos.miksoftwarecol.com)
DOMAIN_PARTS=\$(echo "\$DOMAIN" | tr '.' '\\n' | wc -l)
if [ "\$DOMAIN_PARTS" -gt 2 ]; then
    IS_SUBDOMAIN="true"
else
    IS_SUBDOMAIN="false"
fi

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

        if ss -tuln 2>/dev/null | grep -qE ":80\\s|:443\\s"; then
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

# ============================================
# VERIFICAR PROYECTO EXISTENTE
# ============================================

PROJECT_DIR="/root/proyectos/\${PROJECT_NAME}"

if [ -d "\$PROJECT_DIR" ]; then
    if [ "\$FORCE_OVERWRITE" = "true" ]; then
        echo -e "\${YELLOW}⚠️  Eliminando proyecto existente...\${NC}"
        cd "\$PROJECT_DIR" 2>/dev/null || true
        docker compose down -v --remove-orphans 2>/dev/null || true
        docker rm -f \${PROJECT_NAME}_php \${PROJECT_NAME}_mysql \${PROJECT_NAME}_nginx \${PROJECT_NAME}_redis 2>/dev/null || true
        docker volume rm \${PROJECT_NAME}_mysql_data 2>/dev/null || true
        rm -rf "\$PROJECT_DIR"
        echo -e "\${GREEN}✓ Proyecto anterior eliminado\${NC}"
    else
        echo -e "\${RED}❌ Error: El proyecto ya existe\${NC}"
        exit 1
    fi
fi

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
           ! docker ps --format '{{.Ports}}' 2>/dev/null | grep -qE "0\\.0\\.0\\.0:\$port->"; then
            echo \$port
            return 0
        fi
        port=\$((port + 1))
    done
    echo \$((start_port + 1000))
}

if [ "\$HAS_DOMAIN" = "true" ]; then
    NGINX_PORT="traefik"
    echo -e "\${GREEN}✓ Usando Traefik para \$DOMAIN\${NC}"
else
    NGINX_PORT=\$(find_available_port 8001)
    echo -e "\${GREEN}✓ Puerto HTTP: \$NGINX_PORT\${NC}"
fi

MYSQL_PORT=\$(find_available_port 3307)
echo -e "\${GREEN}✓ Puerto MySQL: \$MYSQL_PORT\${NC}"

# ============================================
# CREAR ESTRUCTURA DEL PROYECTO
# ============================================

echo ""
echo -e "\${YELLOW}📁 Creando estructura...\${NC}"

if [ "\$IS_LARAVEL" = "true" ]; then
    mkdir -p "\$PROJECT_DIR"/{php-config,backups}
else
    mkdir -p "\$PROJECT_DIR"/{public,php-config,backups}
fi

echo -e "\${GREEN}✓ Estructura creada\${NC}"

# ============================================
# CLONAR REPOSITORIO GIT (Laravel)
# ============================================

if [ "\$IS_LARAVEL" = "true" ] && [ "\$HAS_GIT_REPO" = "true" ]; then
    echo ""
    echo -e "\${YELLOW}📦 Clonando repositorio Laravel...\${NC}"
    echo -e "\${BLUE}    URL: \$GIT_REPO_URL\${NC}"
    echo -e "\${BLUE}    Rama: \$GIT_BRANCH\${NC}"
    
    cd "\$PROJECT_DIR"
    
    if git clone -b "\$GIT_BRANCH" "\$GIT_REPO_URL" src 2>/dev/null || git clone "\$GIT_REPO_URL" src; then
        echo -e "\${GREEN}✓ Repositorio clonado exitosamente en src/\${NC}"
        
        cd src
        LAST_COMMIT=\$(git log -1 --pretty=format:'%h - %s (%ar) por %an' 2>/dev/null || echo "N/A")
        echo -e "\${BLUE}    📝 Último commit: \$LAST_COMMIT\${NC}"
        cd ..
    else
        echo -e "\${RED}❌ Error al clonar el repositorio\${NC}"
        echo -e "\${YELLOW}💡 Verifica que la URL sea correcta y accesible\${NC}"
        exit 1
    fi
elif [ "\$HAS_GIT_REPO" = "true" ]; then
    echo ""
    echo -e "\${YELLOW}📦 Clonando repositorio PHP...\${NC}"
    cd "\$PROJECT_DIR"
    
    if git clone "\$GIT_REPO_URL" public; then
        echo -e "\${GREEN}✓ Repositorio clonado en public/\${NC}"
    else
        echo -e "\${RED}❌ Error al clonar el repositorio\${NC}"
        exit 1
    fi
fi

# ============================================
# CREAR Dockerfile
# ============================================

echo ""
echo -e "\${YELLOW}🐳 Generando Dockerfile...\${NC}"

if [ "\$IS_LARAVEL" = "true" ]; then
    cat > "\$PROJECT_DIR/Dockerfile" <<'DOCKERFILE'
FROM php:8.3-fpm

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y \\
    git \\
    curl \\
    libpng-dev \\
    libjpeg62-turbo-dev \\
    libfreetype6-dev \\
    libonig-dev \\
    libxml2-dev \\
    libzip-dev \\
    libicu-dev \\
    libpq-dev \\
    zip \\
    unzip \\
    supervisor \\
    && apt-get clean \\
    && rm -rf /var/lib/apt/lists/*

# Configurar e instalar extensiones PHP
RUN docker-php-ext-configure gd --with-freetype --with-jpeg
RUN docker-php-ext-install \\
    pdo \\
    pdo_mysql \\
    mysqli \\
    mbstring \\
    exif \\
    pcntl \\
    bcmath \\
    gd \\
    opcache \\
    zip \\
    intl

# Instalar Redis extension
RUN pecl install redis && docker-php-ext-enable redis

# Instalar Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer

# Configuración PHP optimizada para Laravel
RUN echo "upload_max_filesize = 100M" >> /usr/local/etc/php/php.ini && \\
    echo "post_max_size = 100M" >> /usr/local/etc/php/php.ini && \\
    echo "memory_limit = 512M" >> /usr/local/etc/php/php.ini && \\
    echo "max_execution_time = 300" >> /usr/local/etc/php/php.ini && \\
    echo "max_input_time = 300" >> /usr/local/etc/php/php.ini && \\
    echo "session.save_handler = files" >> /usr/local/etc/php/php.ini && \\
    echo "session.save_path = /tmp" >> /usr/local/etc/php/php.ini

# Configuración OPcache para producción
RUN echo "opcache.enable=1" >> /usr/local/etc/php/conf.d/opcache.ini && \\
    echo "opcache.memory_consumption=256" >> /usr/local/etc/php/conf.d/opcache.ini && \\
    echo "opcache.interned_strings_buffer=16" >> /usr/local/etc/php/conf.d/opcache.ini && \\
    echo "opcache.max_accelerated_files=20000" >> /usr/local/etc/php/conf.d/opcache.ini && \\
    echo "opcache.validate_timestamps=0" >> /usr/local/etc/php/conf.d/opcache.ini && \\
    echo "opcache.save_comments=1" >> /usr/local/etc/php/conf.d/opcache.ini

RUN chmod 1777 /tmp

WORKDIR /var/www/html
DOCKERFILE
else
    cat > "\$PROJECT_DIR/Dockerfile" <<'DOCKERFILE'
FROM php:8.3-fpm
RUN apt-get update && apt-get install -y libpng-dev libonig-dev libxml2-dev zip unzip && apt-get clean
RUN docker-php-ext-install mysqli pdo pdo_mysql mbstring opcache
RUN echo "upload_max_filesize = 500M" >> /usr/local/etc/php/php.ini && \\
    echo "post_max_size = 500M" >> /usr/local/etc/php/php.ini && \\
    echo "memory_limit = 512M" >> /usr/local/etc/php/php.ini
RUN chmod 1777 /tmp
DOCKERFILE
fi
echo -e "\${GREEN}✓ Dockerfile creado\${NC}"

# ============================================
# CREAR docker-compose.yml
# ============================================

echo ""
echo -e "\${YELLOW}🐳 Generando docker-compose.yml...\${NC}"

if [ "\$IS_LARAVEL" = "true" ]; then
    # ---- LARAVEL docker-compose ----
    if [ "\$HAS_DOMAIN" = "true" ]; then
        cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}

services:
  php:
    build: .
    container_name: \${PROJECT_NAME}_php
    working_dir: /var/www/html
    volumes:
      - ./src:/var/www/html
      - ./php-config/custom.ini:/usr/local/etc/php/conf.d/custom.ini
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    restart: unless-stopped
    depends_on:
      - mysql\$([ "\$USE_REDIS" = "true" ] && echo "
      - redis")
    environment:
      - APP_ENV=production
      - APP_DEBUG=false

  mysql:
    image: mysql:\${MYSQL_VERSION}
    container_name: \${PROJECT_NAME}_mysql
    restart: unless-stopped
    command:
      - --default-authentication-plugin=mysql_native_password
      - --performance-schema=OFF
      - --innodb-buffer-pool-size=64M
      - --max-connections=50
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASS}
      MYSQL_DATABASE: \${DB_NAME}
      MYSQL_USER: \${DB_USER}
      MYSQL_PASSWORD: \${DB_PASS}
    volumes:
      - \${PROJECT_NAME}_mysql_data:/var/lib/mysql
    ports:
      - "\${MYSQL_PORT}:3306"
    networks:
      - \${PROJECT_NAME}_network
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p\${DB_ROOT_PASS}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s\$([ "\$USE_REDIS" = "true" ] && echo "

  redis:
    image: redis:7-alpine
    container_name: \${PROJECT_NAME}_redis
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
    volumes:
      - \${PROJECT_NAME}_redis_data:/data
    networks:
      - \${PROJECT_NAME}_network
    healthcheck:
      test: [\"CMD\", \"redis-cli\", \"ping\"]
      interval: 10s
      timeout: 5s
      retries: 5")

  nginx:
    image: nginx:alpine
    container_name: \${PROJECT_NAME}_nginx
    restart: unless-stopped
    volumes:
      - ./src:/var/www/html
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - php
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=traefik_network"
      - "traefik.http.routers.\${PROJECT_NAME}-http.rule=Host(\\\`\$DOMAIN\\\`) || Host(\\\`www.\$DOMAIN\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-http.entrypoints=web"
      - "traefik.http.routers.\${PROJECT_NAME}-http.middlewares=\${PROJECT_NAME}-redirect-https"
      - "traefik.http.routers.\${PROJECT_NAME}-https.rule=Host(\\\`\$DOMAIN\\\`) || Host(\\\`www.\$DOMAIN\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}-https.entrypoints=websecure"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls=true"
      - "traefik.http.routers.\${PROJECT_NAME}-https.tls.certresolver=letsencrypt"
      - "traefik.http.services.\${PROJECT_NAME}-service.loadbalancer.server.port=80"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.scheme=https"
      - "traefik.http.middlewares.\${PROJECT_NAME}-redirect-https.redirectscheme.permanent=true"

networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true

volumes:
  \${PROJECT_NAME}_mysql_data:\$([ "\$USE_REDIS" = "true" ] && echo "
  \${PROJECT_NAME}_redis_data:")
EOF
    else
        cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}

services:
  php:
    build: .
    container_name: \${PROJECT_NAME}_php
    working_dir: /var/www/html
    volumes:
      - ./src:/var/www/html
      - ./php-config/custom.ini:/usr/local/etc/php/conf.d/custom.ini
    networks:
      - \${PROJECT_NAME}_network
    restart: unless-stopped
    depends_on:
      - mysql\$([ "\$USE_REDIS" = "true" ] && echo "
      - redis")
    environment:
      - APP_ENV=production
      - APP_DEBUG=false

  mysql:
    image: mysql:\${MYSQL_VERSION}
    container_name: \${PROJECT_NAME}_mysql
    restart: unless-stopped
    command:
      - --default-authentication-plugin=mysql_native_password
      - --performance-schema=OFF
      - --innodb-buffer-pool-size=64M
      - --max-connections=50
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASS}
      MYSQL_DATABASE: \${DB_NAME}
      MYSQL_USER: \${DB_USER}
      MYSQL_PASSWORD: \${DB_PASS}
    volumes:
      - \${PROJECT_NAME}_mysql_data:/var/lib/mysql
    ports:
      - "\${MYSQL_PORT}:3306"
    networks:
      - \${PROJECT_NAME}_network
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-u", "root", "-p\${DB_ROOT_PASS}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s\$([ "\$USE_REDIS" = "true" ] && echo "

  redis:
    image: redis:7-alpine
    container_name: \${PROJECT_NAME}_redis
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
    volumes:
      - \${PROJECT_NAME}_redis_data:/data
    networks:
      - \${PROJECT_NAME}_network
    healthcheck:
      test: [\"CMD\", \"redis-cli\", \"ping\"]
      interval: 10s
      timeout: 5s
      retries: 5")

  nginx:
    image: nginx:alpine
    container_name: \${PROJECT_NAME}_nginx
    restart: unless-stopped
    ports:
      - "\${NGINX_PORT}:80"
    volumes:
      - ./src:/var/www/html
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - php
    networks:
      - \${PROJECT_NAME}_network

networks:
  \${PROJECT_NAME}_network:
    driver: bridge

volumes:
  \${PROJECT_NAME}_mysql_data:\$([ "\$USE_REDIS" = "true" ] && echo "
  \${PROJECT_NAME}_redis_data:")
EOF
    fi
else
    # ---- PHP PURO docker-compose ----
    if [ "\$HAS_DOMAIN" = "true" ]; then
        cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  php:
    build: .
    container_name: \${PROJECT_NAME}_php
    working_dir: /var/www/html
    volumes:
      - ./public:/var/www/html
      - ./php-config/custom.ini:/usr/local/etc/php/conf.d/custom.ini
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    restart: unless-stopped
    depends_on:
      - mysql
  mysql:
    image: mysql:\${MYSQL_VERSION}
    container_name: \${PROJECT_NAME}_mysql
    restart: unless-stopped
    command:
      - --default-authentication-plugin=mysql_native_password
      - --performance-schema=OFF
      - --innodb-buffer-pool-size=64M
      - --max-connections=50
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASS}
      MYSQL_DATABASE: \${DB_NAME}
      MYSQL_USER: \${DB_USER}
      MYSQL_PASSWORD: \${DB_PASS}
    volumes:
      - \${PROJECT_NAME}_mysql_data:/var/lib/mysql
    ports:
      - "\${MYSQL_PORT}:3306"
    networks:
      - \${PROJECT_NAME}_network
  nginx:
    image: nginx:alpine
    container_name: \${PROJECT_NAME}_nginx
    restart: unless-stopped
    volumes:
      - ./public:/var/www/html
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - php
    networks:
      - \${PROJECT_NAME}_network
      - traefik_network
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.\${PROJECT_NAME}.rule=Host(\\\`\$DOMAIN\\\`) || Host(\\\`www.\$DOMAIN\\\`)"
      - "traefik.http.routers.\${PROJECT_NAME}.entrypoints=websecure"
      - "traefik.http.routers.\${PROJECT_NAME}.tls.certresolver=letsencrypt"
      - "traefik.http.services.\${PROJECT_NAME}.loadbalancer.server.port=80"
      - "traefik.docker.network=traefik_network"
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
  traefik_network:
    external: true
volumes:
  \${PROJECT_NAME}_mysql_data:
EOF
    else
        cat > "\$PROJECT_DIR/docker-compose.yml" <<EOF
name: \${PROJECT_NAME}
services:
  php:
    build: .
    container_name: \${PROJECT_NAME}_php
    working_dir: /var/www/html
    volumes:
      - ./public:/var/www/html
      - ./php-config/custom.ini:/usr/local/etc/php/conf.d/custom.ini
    networks:
      - \${PROJECT_NAME}_network
    restart: unless-stopped
    depends_on:
      - mysql
  mysql:
    image: mysql:\${MYSQL_VERSION}
    container_name: \${PROJECT_NAME}_mysql
    restart: unless-stopped
    command:
      - --default-authentication-plugin=mysql_native_password
      - --performance-schema=OFF
      - --innodb-buffer-pool-size=64M
      - --max-connections=50
    environment:
      MYSQL_ROOT_PASSWORD: \${DB_ROOT_PASS}
      MYSQL_DATABASE: \${DB_NAME}
      MYSQL_USER: \${DB_USER}
      MYSQL_PASSWORD: \${DB_PASS}
    volumes:
      - \${PROJECT_NAME}_mysql_data:/var/lib/mysql
    ports:
      - "\${MYSQL_PORT}:3306"
    networks:
      - \${PROJECT_NAME}_network
  nginx:
    image: nginx:alpine
    container_name: \${PROJECT_NAME}_nginx
    restart: unless-stopped
    ports:
      - "\${NGINX_PORT}:80"
    volumes:
      - ./public:/var/www/html
      - ./nginx.conf:/etc/nginx/conf.d/default.conf
    depends_on:
      - php
    networks:
      - \${PROJECT_NAME}_network
networks:
  \${PROJECT_NAME}_network:
    driver: bridge
volumes:
  \${PROJECT_NAME}_mysql_data:
EOF
    fi
fi

# Si es subdominio, quitar la regla www del docker-compose
if [ "\$IS_SUBDOMAIN" = "true" ] && [ "\$HAS_DOMAIN" = "true" ]; then
    sed -i "s/ || Host(\`www.\$DOMAIN\`)//g" "\$PROJECT_DIR/docker-compose.yml"
    echo -e "\${BLUE}ℹ️  Subdominio detectado: se omitió www.\$DOMAIN\${NC}"
fi

echo -e "\${GREEN}✓ docker-compose.yml creado\${NC}"

# ============================================
# CREAR nginx.conf
# ============================================

echo ""
echo -e "\${YELLOW}🌐 Generando nginx.conf...\${NC}"

if [ "\$IS_LARAVEL" = "true" ]; then
    cat > "\$PROJECT_DIR/nginx.conf" <<'NGINX_CONF'
server {
    listen 80;
    server_name _;
    root /var/www/html/public;
    index index.php index.html;

    # Límites
    client_max_body_size 100M;
    client_body_timeout 600s;
    client_header_timeout 600s;

    # Logs
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    # Cabeceras de seguridad
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Laravel routing
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    # PHP-FPM
    location ~ \.php$ {
        try_files $uri =404;
        fastcgi_split_path_info ^(.+\.php)(/.+)$;
        fastcgi_pass php:9000;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param PATH_INFO $fastcgi_path_info;
        include fastcgi_params;
        fastcgi_read_timeout 600;
        fastcgi_send_timeout 600;
        fastcgi_buffers 16 16k;
        fastcgi_buffer_size 32k;
    }

    # Negar acceso a archivos ocultos (.env, .git, etc.)
    location ~ /\\.(?!well-known) {
        deny all;
    }

    # Assets estáticos con cache
    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot|webp|avif)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Negar acceso a archivos sensibles de Laravel
    location ~* (composer\\.json|composer\\.lock|package\\.json|webpack\\.mix\\.js|artisan)$ {
        deny all;
    }
}
NGINX_CONF
else
    cat > "\$PROJECT_DIR/nginx.conf" <<'NGINX_CONF'
server {
    listen 80;
    server_name _;
    root /var/www/html;
    index index.php index.html;

    client_max_body_size 500M;
    client_body_timeout 600s;
    client_header_timeout 600s;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    rewrite ^/(.*)/$ /$1 permanent;

    location / {
        try_files $uri $uri/ @rewrite;
    }

    location @rewrite {
        if (-f $request_filename.html) { rewrite ^(.+)$ $1.html last; }
        if (-f $request_filename.php) { rewrite ^(.+)$ $1.php last; }
        return 404;
    }

    location ~ \\.php$ {
        try_files $uri =404;
        fastcgi_split_path_info ^(.+\\.php)(/.+)$;
        fastcgi_pass php:9000;
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_param QUERY_STRING $query_string;
        include fastcgi_params;
        fastcgi_read_timeout 600;
        fastcgi_send_timeout 600;
        fastcgi_buffers 16 16k;
        fastcgi_buffer_size 32k;
    }

    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location ~ /\\. {
        deny all;
    }
}
NGINX_CONF
fi
echo -e "\${GREEN}✓ nginx.conf creado\${NC}"

# ============================================
# CONFIGURAR PHP
# ============================================

echo ""
echo -e "\${YELLOW}⚙️  Configuración PHP...\${NC}"
cat > "\$PROJECT_DIR/php-config/custom.ini" <<'PHP_INI'
upload_max_filesize = 100M
post_max_size = 100M
memory_limit = 512M
max_execution_time = 300
max_input_time = 300
display_errors = Off
log_errors = On
error_log = /var/log/php_errors.log
PHP_INI
echo -e "\${GREEN}✓ PHP configurado\${NC}"

# ============================================
# LEVANTAR CONTENEDORES (primero para que MySQL inicie)
# ============================================

echo ""
echo -e "\${YELLOW}🐳 Construyendo y levantando contenedores...\${NC}"
cd "\$PROJECT_DIR"
docker compose up -d --build --remove-orphans

echo ""
echo -e "\${YELLOW}⏳ Esperando a que MySQL esté listo...\${NC}"

# Esperar hasta 60 segundos a que MySQL responda
MYSQL_READY=0
for i in \$(seq 1 60); do
    if docker exec \${PROJECT_NAME}_mysql mysqladmin ping -h localhost -uroot -p\${DB_ROOT_PASS} 2>/dev/null | grep -q "alive"; then
        MYSQL_READY=1
        break
    fi
    sleep 1
done

if [ "\$MYSQL_READY" = "1" ]; then
    echo -e "\${GREEN}✓ MySQL está listo\${NC}"
else
    echo -e "\${YELLOW}⚠️  MySQL tarda en iniciar, esperando 20s más...\${NC}"
    sleep 20
fi

# Configurar autenticación MySQL
docker exec \${PROJECT_NAME}_mysql mysql -uroot -p\${DB_ROOT_PASS} -e "ALTER USER '\${DB_USER}'@'%' IDENTIFIED WITH mysql_native_password BY '\${DB_PASS}'; FLUSH PRIVILEGES;" 2>/dev/null || true
echo -e "\${GREEN}✓ MySQL configurado\${NC}"

# ============================================
# CONFIGURAR LARAVEL (dentro del contenedor PHP)
# ============================================

if [ "\$IS_LARAVEL" = "true" ] && [ "\$HAS_GIT_REPO" = "true" ]; then
    echo ""
    echo -e "\${YELLOW}📦 Configurando Laravel...\${NC}"

    # --- PASO 1: Generar .env ---
    echo -e "\${YELLOW}  [1/8] 📄 Generando archivo .env...\${NC}"
    
    if [ -f "\$PROJECT_DIR/src/.env.example" ]; then
        cp "\$PROJECT_DIR/src/.env.example" "\$PROJECT_DIR/src/.env"
    else
        cat > "\$PROJECT_DIR/src/.env" <<ENVFILE
APP_NAME="\${PROJECT_NAME}"
APP_ENV=production
APP_KEY=
APP_DEBUG=false
APP_TIMEZONE=America/Bogota
APP_URL=\${HAS_DOMAIN:+https://\$DOMAIN}\${HAS_DOMAIN:-http://localhost}

LOG_CHANNEL=stack
LOG_LEVEL=error

DB_CONNECTION=mysql
DB_HOST=mysql
DB_PORT=3306
DB_DATABASE=\${DB_NAME}
DB_USERNAME=\${DB_USER}
DB_PASSWORD=\${DB_PASS}

SESSION_DRIVER=\$([ "\$USE_REDIS" = "true" ] && echo "redis" || echo "database")
SESSION_LIFETIME=120

CACHE_STORE=\$([ "\$USE_REDIS" = "true" ] && echo "redis" || echo "database")
QUEUE_CONNECTION=\$([ "\$USE_REDIS" = "true" ] && echo "redis" || echo "database")

REDIS_HOST=\$([ "\$USE_REDIS" = "true" ] && echo "redis" || echo "127.0.0.1")
REDIS_PASSWORD=null
REDIS_PORT=6379

MAIL_MAILER=log
ENVFILE
    fi

    # Actualizar valores en .env (en caso de que se copió de .env.example)
    cd "\$PROJECT_DIR/src"
    
    # Usar sed para establecer las variables de BD
    sed -i "s|^DB_CONNECTION=.*|DB_CONNECTION=mysql|" .env
    sed -i "s|^DB_HOST=.*|DB_HOST=mysql|" .env
    sed -i "s|^DB_PORT=.*|DB_PORT=3306|" .env
    sed -i "s|^DB_DATABASE=.*|DB_DATABASE=\${DB_NAME}|" .env
    sed -i "s|^DB_USERNAME=.*|DB_USERNAME=\${DB_USER}|" .env
    sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=\${DB_PASS}|" .env
    sed -i "s|^APP_ENV=.*|APP_ENV=production|" .env
    sed -i "s|^APP_DEBUG=.*|APP_DEBUG=false|" .env
    
    if [ "\$HAS_DOMAIN" = "true" ]; then
        sed -i "s|^APP_URL=.*|APP_URL=https://\$DOMAIN|" .env
    fi
    
    if [ "\$USE_REDIS" = "true" ]; then
        sed -i "s|^REDIS_HOST=.*|REDIS_HOST=redis|" .env
        sed -i "s|^SESSION_DRIVER=.*|SESSION_DRIVER=redis|" .env
        sed -i "s|^CACHE_STORE=.*|CACHE_STORE=redis|" .env 2>/dev/null || true
        sed -i "s|^CACHE_DRIVER=.*|CACHE_DRIVER=redis|" .env 2>/dev/null || true
        sed -i "s|^QUEUE_CONNECTION=.*|QUEUE_CONNECTION=redis|" .env
    fi
    
    # Hacer .env escribible
    chmod 666 "\$PROJECT_DIR/src/.env"
    echo -e "\${GREEN}  ✓ .env configurado (permisos: 666)\${NC}"
    
    cd "\$PROJECT_DIR"

    # --- PASO 2: Composer Install ---
    echo -e "\${YELLOW}  [2/8] 📦 Instalando dependencias con Composer...\${NC}"
    docker exec -w /var/www/html \${PROJECT_NAME}_php composer install --no-dev --optimize-autoloader --no-interaction 2>&1 | tail -5
    echo -e "\${GREEN}  ✓ Dependencias instaladas\${NC}"

    # --- PASO 2.5: Publicar assets de Livewire (si existe) ---
    echo -e "\${YELLOW}  [2.5/8] 📦 Publicando assets de paquetes (Livewire, etc.)...\${NC}"
    docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan vendor:publish --force --tag=livewire:assets 2>/dev/null && echo -e "\${GREEN}  ✓ Livewire assets publicados\${NC}" || echo -e "\${BLUE}  ⏭️  Livewire no detectado, saltando\${NC}"
    docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan vendor:publish --force --tag=livewire:config 2>/dev/null || true

    # --- PASO 3: Generar APP_KEY ---
    echo -e "\${YELLOW}  [3/8] 🔑 Generando APP_KEY...\${NC}"
    docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan key:generate --force
    echo -e "\${GREEN}  ✓ APP_KEY generada\${NC}"

    # --- PASO 4: Permisos ---
    echo -e "\${YELLOW}  [4/8] 🔐 Ajustando permisos...\${NC}"
    docker exec \${PROJECT_NAME}_php chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache
    docker exec \${PROJECT_NAME}_php chmod -R 775 /var/www/html/storage /var/www/html/bootstrap/cache
    
    # Crear directorios de storage si no existen
    docker exec \${PROJECT_NAME}_php mkdir -p /var/www/html/storage/framework/{sessions,views,cache}
    docker exec \${PROJECT_NAME}_php mkdir -p /var/www/html/storage/logs
    docker exec \${PROJECT_NAME}_php chown -R www-data:www-data /var/www/html/storage
    docker exec \${PROJECT_NAME}_php chmod -R 775 /var/www/html/storage
    echo -e "\${GREEN}  ✓ Permisos configurados\${NC}"

    # --- PASO 5: Storage Link ---
    echo -e "\${YELLOW}  [5/8] 🔗 Creando storage link...\${NC}"
    docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan storage:link --force 2>/dev/null || true
    echo -e "\${GREEN}  ✓ Storage link creado\${NC}"

    # --- PASO 6: Migraciones ---
    echo -e "\${YELLOW}  [6/8] 🗄️  Ejecutando migraciones...\${NC}"
    if docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan migrate --force 2>&1; then
        echo -e "\${GREEN}  ✓ Migraciones ejecutadas\${NC}"
    else
        echo -e "\${YELLOW}  ⚠️  Las migraciones reportaron un problema (puede ser normal si no hay migraciones)\${NC}"
    fi

    # --- PASO 7: Node.js Build (si aplica) ---
    if [ "\$USE_NODE_BUILD" = "true" ]; then
        echo -e "\${YELLOW}  [7/8] 📦 Compilando assets con Node.js...\${NC}"
        
        # Instalar Node.js dentro del contenedor PHP
        docker exec \${PROJECT_NAME}_php bash -c "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs" 2>&1 | tail -3
        
        if [ -f "\$PROJECT_DIR/src/package.json" ]; then
            docker exec -w /var/www/html \${PROJECT_NAME}_php npm install 2>&1 | tail -3
            docker exec -w /var/www/html \${PROJECT_NAME}_php npm run build 2>&1 | tail -5
            echo -e "\${GREEN}  ✓ Assets compilados\${NC}"
        else
            echo -e "\${YELLOW}  ⚠️  No se encontró package.json, saltando build de assets\${NC}"
        fi
    else
        echo -e "\${BLUE}  [7/8] ⏭️  Node.js build desactivado\${NC}"
    fi

    # --- PASO 8: Cache de Laravel (producción) ---
    echo -e "\${YELLOW}  [8/8] ⚡ Optimizando Laravel para producción...\${NC}"
    docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan config:cache 2>/dev/null || true
    docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan route:cache 2>/dev/null || true
    docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan view:cache 2>/dev/null || true
    docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan event:cache 2>/dev/null || true
    
    # Publicar assets de Livewire al public (si existe)
    docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan livewire:publish --assets 2>/dev/null || true
    
    # Asegurar permisos finales del .env
    chmod 666 "\$PROJECT_DIR/src/.env"
    docker exec \${PROJECT_NAME}_php chmod 666 /var/www/html/.env 2>/dev/null || true
    
    echo -e "\${GREEN}  ✓ Laravel optimizado para producción\${NC}"

    # Reiniciar PHP-FPM para cargar nueva config
    docker compose restart php nginx
    sleep 3
    echo -e "\${GREEN}✅ Laravel configurado completamente\${NC}"

    # ============================================
    # CREAR deploy.sh PARA LARAVEL
    # ============================================

    echo ""
    echo -e "\${YELLOW}📜 Creando script deploy.sh...\${NC}"

    cat > "\$PROJECT_DIR/deploy.sh" <<'DEPLOY_SCRIPT'
#!/bin/bash

# ============================================
# Script de Deploy Automático para Laravel
# ============================================

GREEN='\\033[0;32m'
RED='\\033[0;31m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m'

SCRIPT_DIR=\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)
PROJECT_DIR="\$SCRIPT_DIR"
SRC_DIR="\$PROJECT_DIR/src"
DEPLOY_SCRIPT

    # Inyectar el nombre del proyecto
    sed -i "1a\\PROJECT_NAME=\\"\${PROJECT_NAME}\\"" "\$PROJECT_DIR/deploy.sh"

    cat >> "\$PROJECT_DIR/deploy.sh" <<'DEPLOY_SCRIPT2'

echo -e "\${BLUE}=========================================="
echo "  🚀 Deploy Laravel: \$PROJECT_NAME"
echo "==========================================\${NC}"
echo ""

cd "\$SRC_DIR"

echo -e "\${YELLOW}[1/7] ⬇️  Descargando cambios desde Git...\${NC}"
git stash --quiet 2>/dev/null || true

BRANCH=\$(git rev-parse --abbrev-ref HEAD)
if git pull origin "\$BRANCH" 2>&1; then
    echo -e "\${GREEN}✓ Cambios descargados desde rama '\$BRANCH'\${NC}"
else
    echo -e "\${RED}✗ Error al descargar cambios\${NC}"
    exit 1
fi

LAST_COMMIT=\$(git log -1 --pretty=format:'%h - %s (%ar) por %an')
echo -e "\${BLUE}    📝 Último commit: \$LAST_COMMIT\${NC}"

echo ""
echo -e "\${YELLOW}[2/7] 📦 Composer install...\${NC}"
docker exec -w /var/www/html \${PROJECT_NAME}_php composer install --no-dev --optimize-autoloader --no-interaction 2>&1 | tail -5
echo -e "\${GREEN}✓ Dependencias actualizadas\${NC}"

echo ""
echo -e "\${YELLOW}[3/7] 🗄️  Migraciones...\${NC}"
docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan migrate --force 2>&1
echo -e "\${GREEN}✓ Migraciones ejecutadas\${NC}"

echo ""
echo -e "\${YELLOW}[4/7] 📦 Compilando assets...\${NC}"
if [ -f "\$SRC_DIR/package.json" ]; then
    docker exec -w /var/www/html \${PROJECT_NAME}_php npm install 2>&1 | tail -3
    docker exec -w /var/www/html \${PROJECT_NAME}_php npm run build 2>&1 | tail -5
    echo -e "\${GREEN}✓ Assets compilados\${NC}"
else
    echo -e "\${BLUE}⏭️  Sin package.json, saltando\${NC}"
fi

echo ""
echo -e "\${YELLOW}[5/7] 🔐 Ajustando permisos...\${NC}"
docker exec \${PROJECT_NAME}_php chown -R www-data:www-data /var/www/html/storage /var/www/html/bootstrap/cache
docker exec \${PROJECT_NAME}_php chmod -R 775 /var/www/html/storage /var/www/html/bootstrap/cache
docker exec \${PROJECT_NAME}_php chmod 666 /var/www/html/.env 2>/dev/null || true
echo -e "\${GREEN}✓ Permisos ajustados\${NC}"

echo ""
echo -e "\${YELLOW}[5.5/7] 📦 Publicando assets (Livewire, etc.)...\${NC}"
docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan vendor:publish --force --tag=livewire:assets 2>/dev/null || true
docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan livewire:publish --assets 2>/dev/null || true
echo -e "\${GREEN}✓ Assets publicados\${NC}"

echo ""
echo -e "\${YELLOW}[6/7] ⚡ Limpiando y recacheando...\${NC}"
docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan config:cache
docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan route:cache
docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan view:cache
docker exec -w /var/www/html \${PROJECT_NAME}_php php artisan event:cache 2>/dev/null || true
echo -e "\${GREEN}✓ Cache reconstruida\${NC}"

echo ""
echo -e "\${YELLOW}[7/7] 🔄 Reiniciando servicios...\${NC}"
cd "\$PROJECT_DIR"
docker compose restart php nginx
sleep 3
echo -e "\${GREEN}✓ Servicios reiniciados\${NC}"

echo ""
echo -e "\${GREEN}=========================================="
echo "  ✅ Deploy completado exitosamente"
echo "==========================================\${NC}"
echo ""
echo -e "\${BLUE}📅 Fecha: \$(date '+%Y-%m-%d %H:%M:%S')\${NC}"
echo -e "\${BLUE}🔀 Rama: \$BRANCH\${NC}"
echo -e "\${BLUE}📝 Commit: \$LAST_COMMIT\${NC}"
echo ""
DEPLOY_SCRIPT2

    chmod +x "\$PROJECT_DIR/deploy.sh"
    echo -e "\${GREEN}✓ deploy.sh creado\${NC}"

else
    # PHP puro
    if [ "\$HAS_GIT_REPO" = "true" ]; then
        # Crear deploy.sh para PHP puro con repositorio Git
        echo ""
        echo -e "\${YELLOW}� Creando script deploy.sh...\${NC}"

        cat > "\$PROJECT_DIR/deploy.sh" <<DEPLOY_SCRIPT
#!/bin/bash

# ============================================
# Script de Deploy Automático
# Proyecto: \$PROJECT_NAME
# Repositorio: \$GIT_REPO_URL
# Uso: bash deploy.sh o: cd /root/proyectos/\$PROJECT_NAME && ./deploy.sh
# ============================================

echo "=========================================="
echo "  🚀 Deploy \$PROJECT_NAME"
echo "  📦 Repo: \$GIT_REPO_URL"
echo "=========================================="
echo ""

GREEN='\\033[0;32m'
RED='\\033[0;31m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m'

PROJECT_DIR="/root/proyectos/\$PROJECT_NAME"
PUBLIC_DIR="\\\$PROJECT_DIR/public"

cd \\\$PUBLIC_DIR

echo -e "\\\${BLUE}📁 Directorio: \\\$(pwd)\\\${NC}"
echo ""

echo -e "\\\${YELLOW}[1/6] 💾 Guardando cambios locales...\\\${NC}"
git stash --quiet 2>/dev/null || true
echo -e "\\\${GREEN}✓ Cambios locales guardados\\\${NC}"

echo ""
echo -e "\\\${YELLOW}[2/6] ⬇️  Descargando cambios desde Git...\\\${NC}"

BRANCH=\\\$(git rev-parse --abbrev-ref HEAD)
if git pull origin "\\\$BRANCH" 2>&1; then
    echo -e "\\\${GREEN}✓ Cambios descargados desde rama '\\\$BRANCH'\\\${NC}"
else
    echo -e "\\\${RED}✗ Error al descargar cambios\\\${NC}"
    exit 1
fi

LAST_COMMIT=\\\$(git log -1 --pretty=format:'%h - %s (%ar) por %an')
echo -e "\\\${BLUE}    📝 Último commit: \\\$LAST_COMMIT\\\${NC}"

echo ""
echo -e "\\\${YELLOW}[3/6] 🔄 Restaurando configuración local...\\\${NC}"
git stash pop --quiet 2>/dev/null || true
echo -e "\\\${GREEN}✓ Configuración restaurada\\\${NC}"

echo ""
echo -e "\\\${YELLOW}[4/6] 🔐 Ajustando permisos...\\\${NC}"
chown -R www-data:www-data \\\$PUBLIC_DIR
find \\\$PUBLIC_DIR -type d -exec chmod 755 {} \\; 2>/dev/null
find \\\$PUBLIC_DIR -type f -exec chmod 644 {} \\; 2>/dev/null
echo -e "\\\${GREEN}✓ Permisos ajustados\\\${NC}"

echo ""
echo -e "\\\${YELLOW}[5/6] 🧹 Limpiando caché...\\\${NC}"
docker exec \${PROJECT_NAME}_php find /tmp -name "sess_*" -mtime +1 -delete 2>/dev/null || true
echo -e "\\\${GREEN}✓ Caché limpiado\\\${NC}"

echo ""
echo -e "\\\${YELLOW}[6/6] 🔄 Reiniciando servicios...\\\${NC}"
cd \\\$PROJECT_DIR
docker compose restart php nginx --quiet
sleep 3
echo -e "\\\${GREEN}✓ Servicios reiniciados\\\${NC}"

echo ""
echo -e "\\\${GREEN}=========================================="
echo "  ✅ Deploy completado exitosamente"
echo "==========================================\\\${NC}"
echo ""
if [ "\$HAS_DOMAIN" = "true" ]; then
    echo -e "\\\${BLUE}🌐 URL: https://\$DOMAIN\\\${NC}"
else
    echo -e "\\\${BLUE}🌐 URL: http://\\\$(hostname -I | awk '{print \\\$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null):\$NGINX_PORT\\\${NC}"
fi
echo -e "\\\${BLUE}📅 Fecha: \\\$(date '+%Y-%m-%d %H:%M:%S')\\\${NC}"
echo -e "\\\${BLUE}🔀 Rama: \\\$BRANCH\\\${NC}"
echo ""
DEPLOY_SCRIPT

        chmod +x "\$PROJECT_DIR/deploy.sh"
        echo -e "\${GREEN}✓ deploy.sh creado en \$PROJECT_DIR/deploy.sh\${NC}"
    else
        echo ""
        echo -e "\${YELLOW}📄 Creando archivo de prueba...\${NC}"
        
        cat > "\$PROJECT_DIR/public/index.php" <<PHPTEST
<?php
echo "<h1>✅ Proyecto: \$PROJECT_NAME</h1>";
echo "<p>PHP: " . phpversion() . "</p>";
\\$conn = new mysqli("mysql", "\$DB_USER", "\$DB_PASS", "\$DB_NAME");
echo \\$conn->connect_error ? "<p style='color:red'>❌ MySQL Error</p>" : "<p style='color:green'>✅ MySQL OK</p>";
?>
PHPTEST
        echo -e "\${GREEN}✓ Archivo de prueba creado\${NC}"
    fi
fi

# ============================================
# GUARDAR CREDENCIALES
# ============================================

echo ""
echo -e "\${YELLOW}💾 Guardando credenciales...\${NC}"

# Desactivar set -e temporalmente para que no falle al guardar credenciales
set +e

SERVER_IP=\$(hostname -I | awk '{print \$1}' || curl -4 -s --connect-timeout 5 ifconfig.me 2>/dev/null || curl -4 -s --connect-timeout 5 ipinfo.io/ip 2>/dev/null || echo "localhost")

if [ "\$HAS_DOMAIN" = "true" ]; then
    URL_ACCESS="https://\$DOMAIN"
else
    URL_ACCESS="http://\${SERVER_IP}:\$NGINX_PORT"
fi

# Determinar estado SSL
if [ "\$HAS_DOMAIN" = "true" ]; then
    SSL_STATUS="Gestionado por Traefik (Let s Encrypt)"
else
    SSL_STATUS="No configurado"
fi

# Escribir credenciales con echo para mayor compatibilidad
{
echo "============================================"
echo "  PROYECTO: \$PROJECT_NAME"
echo "  TIPO: \$PROJECT_TYPE"
echo "  PHP: 8.3"
echo "============================================"
echo ""
echo "URL: \$URL_ACCESS"
echo ""
echo "DATABASE:"
echo "  Host (interno): mysql"
echo "  Host (externo): \$SERVER_IP"
echo "  Puerto: \$MYSQL_PORT"
echo "  Database: \$DB_NAME"
echo "  User: \$DB_USER"
echo "  Password: \$DB_PASS"
echo "  Root Password: \$DB_ROOT_PASS"
echo ""
echo "PUERTOS:"
echo "  HTTP: \$NGINX_PORT"
echo "  MySQL: \$MYSQL_PORT"
echo ""
echo "SSL: \$SSL_STATUS"
} > "\$PROJECT_DIR/CREDENCIALES.txt"

if [ "\$HAS_GIT_REPO" = "true" ]; then
    {
    echo ""
    echo "REPOSITORIO GIT:"
    echo "  URL: \$GIT_REPO_URL"
    echo "  Rama: \$GIT_BRANCH"
    echo "  Deploy Script: \$PROJECT_DIR/deploy.sh"
    echo ""
    echo "Para actualizar el proyecto:"
    echo "  cd \$PROJECT_DIR && ./deploy.sh"
    } >> "\$PROJECT_DIR/CREDENCIALES.txt"
fi

if [ "\$IS_LARAVEL" = "true" ] && [ "\$HAS_GIT_REPO" = "true" ]; then
    {
    echo ""
    echo "SERVICIOS:"
    echo "  Redis: \${USE_REDIS:-No}"
    echo ""
    echo "NOTAS:"
    echo "  - Los archivos del proyecto estan en: \$PROJECT_DIR/src/"
    echo "  - El .env de Laravel esta en: \$PROJECT_DIR/src/.env"
    echo "  - Los logs de Laravel: docker exec \${PROJECT_NAME}_php tail -f /var/www/html/storage/logs/laravel.log"
    } >> "\$PROJECT_DIR/CREDENCIALES.txt"
elif [ "\$HAS_GIT_REPO" = "true" ]; then
    {
    echo ""
    echo "NOTAS:"
    echo "  - Los archivos del proyecto estan en: \$PROJECT_DIR/public/"
    } >> "\$PROJECT_DIR/CREDENCIALES.txt"
fi

chmod 600 "\$PROJECT_DIR/CREDENCIALES.txt"

# Verificar que el archivo no quedó vacío
if [ -s "\$PROJECT_DIR/CREDENCIALES.txt" ]; then
    echo -e "\${GREEN}✓ Credenciales guardadas en \$PROJECT_DIR/CREDENCIALES.txt\${NC}"
else
    echo -e "\${RED}✗ Error: CREDENCIALES.txt quedó vacío, reintentando...\${NC}"
    echo "PROYECTO: \$PROJECT_NAME" > "\$PROJECT_DIR/CREDENCIALES.txt"
    echo "DB: \$DB_NAME | User: \$DB_USER | Pass: \$DB_PASS" >> "\$PROJECT_DIR/CREDENCIALES.txt"
    echo "MySQL Port: \$MYSQL_PORT | HTTP Port: \$NGINX_PORT" >> "\$PROJECT_DIR/CREDENCIALES.txt"
    echo "Root DB Pass: \$DB_ROOT_PASS" >> "\$PROJECT_DIR/CREDENCIALES.txt"
    echo -e "\${YELLOW}⚠️  Credenciales guardadas en formato simplificado\${NC}"
fi

# Reactivar set -e
set -e

echo -e "\${GREEN}✓ Credenciales listas\${NC}"

# ============================================
# RESUMEN FINAL
# ============================================

echo ""
echo -e "\${CYAN}"
echo "============================================"
echo "  ✅ PROYECTO CREADO EXITOSAMENTE"
echo "============================================"
echo -e "\${NC}"
docker compose ps
echo ""
echo -e "\${GREEN}🌐 URL: \$URL_ACCESS\${NC}"
if [ "\$HAS_GIT_REPO" = "true" ]; then
    echo -e "\${GREEN}📦 Repositorio: \$GIT_REPO_URL (\$GIT_BRANCH)\${NC}"
    echo -e "\${GREEN}📜 Deploy script: \$PROJECT_DIR/deploy.sh\${NC}"
fi

# ============================================
# OUTPUT CREDENTIALS (JSON for parsing)
# ============================================
echo "JSON_START"
echo "{"
echo "  \\"project_name\\": \\"\$PROJECT_NAME\\","
echo "  \\"domain\\": \\"\$DOMAIN\\","
echo "  \\"project_type\\": \\"\$PROJECT_TYPE\\","
echo "  \\"php_version\\": \\"8.3\\","
echo "  \\"url\\": \\"\$URL_ACCESS\\","
echo "  \\"db_host\\": \\"\$SERVER_IP\\","
echo "  \\"db_port\\": \\"\$MYSQL_PORT\\","
echo "  \\"db_name\\": \\"\$DB_NAME\\","
echo "  \\"db_user\\": \\"\$DB_USER\\","
echo "  \\"db_pass\\": \\"\$DB_PASS\\","
echo "  \\"nginx_port\\": \\"\$NGINX_PORT\\","
if [ "\$HAS_DOMAIN" = "true" ]; then echo "  \\"ssl\\": \\"traefik\\","; else echo "  \\"ssl\\": \\"none\\","; fi
echo "  \\"git_repo\\": \\"\$GIT_REPO_URL\\","
echo "  \\"git_branch\\": \\"\$GIT_BRANCH\\","
echo "  \\"redis\\": \\"\$USE_REDIS\\","
if [ "\$HAS_GIT_REPO" = "true" ]; then echo "  \\"deploy_script\\": \\"\$PROJECT_DIR/deploy.sh\\""; else echo "  \\"deploy_script\\": \\"none\\""; fi
echo "}"
echo "JSON_END"

`;
}
