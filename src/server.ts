// =============================================================================
// server.ts -- SVG Plot MCP Server Entry Point
// =============================================================================

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { SvgPlotError } from './types.js';
import { renderDiagrams } from './mermaid-renderer.js';

// -----------------------------------------------------------------------------
// Zod Schema for MCP Tool Input Validation
// -----------------------------------------------------------------------------

const DiagramSchema = z.object({
  name: z.string().describe('Diagram identifier'),
  mermaid: z.string().describe('Mermaid diagram source code'),
});

// Accepts both single diagram {name, mermaid} and batch {diagrams: [...]}
// All fields optional at schema level; validated in handler
const RenderDiagramInputSchema = z.object({
  name: z.string().describe('Diagram identifier (single mode)').optional(),
  mermaid: z.string().describe('Mermaid diagram source code (single mode)').optional(),
  diagrams: z
    .array(DiagramSchema)
    .min(1)
    .describe('Array of diagrams to render (batch mode)')
    .optional(),
  theme: z
    .enum(['light', 'dark'])
    .default('light')
    .describe('Color scheme for the diagram palette. Leave at default "light" for report embedding — report templates invert light-authored SVGs for dark mode, so "dark" here would double-invert. "dark" is for non-report-embedding use only.'),
});

// -----------------------------------------------------------------------------
// Error Response Helper
// -----------------------------------------------------------------------------

function buildErrorResponse(error: unknown): {
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
} {
  if (error instanceof SvgPlotError) {
    return {
      content: [{ type: 'text', text: `Error [${error.code}]: ${error.message}` }],
      isError: true,
    };
  }

  if (error instanceof z.ZodError) {
    const formattedErrors = error.issues
      .map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`)
      .join(', ');

    return {
      content: [{ type: 'text', text: `Validation error: ${formattedErrors}` }],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Internal error: ${error instanceof Error ? error.message : String(error)}`,
      },
    ],
    isError: true,
  };
}

// -----------------------------------------------------------------------------
// MCP Server Factory
// -----------------------------------------------------------------------------

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'svg-plot',
    version: '1.0.0',
  });

  // ---------------------------------------------------------------------------
  // Tool: render_diagram
  // ---------------------------------------------------------------------------

  server.tool(
    'render_diagram',
    'Render Mermaid diagrams to SVG. Two modes: (1) Single diagram: {name, mermaid} — backward compatible with pdf-reporter-mcp. (2) Batch: {diagrams: [{name, mermaid}, ...]}. Always returns a JSON array of {name, svg} objects. Diagrams are always rendered as a LIGHT-authored image — opaque white background + fixed dark colors (Royal Blue #4169E1 accent + green/amber/violet family) — regardless of the report you embed them into. Do NOT set theme:"dark" to match a dark report: report templates apply a CSS invert filter to adapt light-authored SVGs for dark mode, so a dark-authored diagram would double-invert into unreadable/black-on-black output (see docs/telegram-html-formatting.md, SVG Diagrams in Reports). Leave theme at its "light" default for any diagram embedded in an HTML/PDF report. Labels are rendered as positioned SVG text (not HTML foreignObject) and long labels wrap, so diagrams stay stable and un-clipped when printed HTML→PDF. Prefer letting the palette style nodes rather than hard-coding per-node fills.',
    RenderDiagramInputSchema.shape,
    async (input) => {
      const tempDir = await mkdtemp(join(tmpdir(), 'svg-plot-'));
      try {
        // Normalize input: single diagram {name, mermaid} or batch {diagrams: [...]}
        let diagrams: Array<{ name: string; mermaid: string }>;

        if (input.diagrams && input.diagrams.length > 0) {
          diagrams = input.diagrams;
        } else if (input.name && input.mermaid) {
          diagrams = [{ name: input.name, mermaid: input.mermaid }];
        } else {
          throw new SvgPlotError(
            'VALIDATION_ERROR',
            'Provide either {name, mermaid} for a single diagram or {diagrams: [...]} for batch rendering',
          );
        }

        const results = await renderDiagrams(diagrams, tempDir, input.theme ?? 'light');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results),
            },
          ],
        };
      } catch (error) {
        return buildErrorResponse(error);
      } finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
  );

  return server;
}

// Singleton for stdio transport (only one connection possible)
const stdioServer = createMcpServer();

// -----------------------------------------------------------------------------
// Main Entry Point
// -----------------------------------------------------------------------------

async function startStdio(): Promise<void> {
  const transport = new StdioServerTransport();
  await stdioServer.connect(transport);
  console.error('SVG Plot MCP server started on stdio');
}

async function startSse(): Promise<void> {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const transports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);
      res.on('close', () => {
        transports.delete(transport.sessionId);
      });
      const sessionServer = createMcpServer(); // fresh instance per connection
      await sessionServer.connect(transport);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400).end('Missing sessionId');
        return;
      }
      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(400).end(`No transport found for sessionId: ${sessionId}`);
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404).end('Not found');
  });

  httpServer.listen(port, () => {
    console.error(`SVG Plot MCP server started on SSE (port ${port})`);
  });
}

async function main(): Promise<void> {
  const transport = process.env.TRANSPORT;
  if (transport === 'sse') {
    await startSse();
  } else {
    await startStdio();
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
