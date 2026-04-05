# SVG Plot MCP

MCP server for rendering Mermaid diagrams to SVG via the Mermaid CLI (mmdc).

## Tool

### render_diagram

Accepts an array of diagrams, each with:
- `name` — diagram identifier
- `content` — Mermaid diagram source code

Returns an array of `{name, svg}` results.

## Transport

- **stdio** (default) — for local MCP integration
- **SSE** — set `TRANSPORT=sse` and optionally `PORT` (default 3000)

## Development

```bash
npm install
npm run dev
```

## Production (Docker)

```bash
docker build -t svg-plot-mcp .
docker run -p 17004:3000 -e TRANSPORT=sse svg-plot-mcp
```

Port 17004 is the assigned MCP convention port for this service.
