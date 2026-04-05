# SVG Plot MCP

MCP server for rendering Mermaid diagrams to SVG.

## Architecture
- Single MCP tool: `render_diagram`
- Uses mmdc (Mermaid CLI) with system Chromium
- Puppeteer config passes --no-sandbox for Docker environments

## Development
- `npm run dev` — development with tsx
- `npm run build` — TypeScript compilation
- `npm start` — production run

## Deployment
- Dokploy via GHCR image
- Port: 17004 (MCP convention)
- Docker maps 3000 -> 17004

## Git Workflow
- Bare repo + worktree structure
- Branch naming: feature/name, fix/name
