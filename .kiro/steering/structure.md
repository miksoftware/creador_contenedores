# Project Structure

```
├── app/                    # Next.js App Router
│   ├── api/
│   │   └── deploy/
│   │       └── route.ts    # POST endpoint - SSH deployment with streaming response
│   ├── layout.tsx          # Root layout with Inter font, dark theme
│   ├── page.tsx            # Home page - renders DeployDashboard
│   └── globals.css         # Tailwind imports, CSS variables, custom utilities
│
├── components/
│   └── deploy-dashboard.tsx  # Main UI component - config form, logs, results
│
├── lib/
│   ├── script-generator.ts   # Generates bash deployment scripts
│   ├── traefik-setup.ts      # Generates Traefik reverse proxy setup script
│   └── utils.ts              # cn() helper for class merging
│
└── public/                 # Static assets
```

## Architecture Patterns

### API Route (`/api/deploy`)
- Accepts POST with SSH credentials and project config
- Returns streaming response (`text/event-stream`)
- Executes generated bash script via SSH (`bash -s`)
- Streams stdout/stderr back to client as JSON lines

### Script Generation
- `generateSetupScript()` creates complete bash scripts for:
  - Traefik installation (if domain provided)
  - Docker Compose setup (PHP-FPM, Nginx, MySQL)
  - Nginx configuration (Laravel vs pure PHP)
  - Credential file generation
- Scripts output JSON block (`JSON_START`/`JSON_END`) for result parsing

### Component State Flow
- `DeployDashboard` manages: config, credentials, step (config/deploying/success/error), logs
- Streams deployment logs and parses JSON result from response
