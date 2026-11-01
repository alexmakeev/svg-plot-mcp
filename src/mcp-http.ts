import type { IncomingMessage, ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

function rpcError(res: ServerResponse, status: number, code: number, message: string): void {
  res
    .writeHead(status, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

export async function handleStatelessMcp(
  req: IncomingMessage,
  res: ServerResponse,
  makeServer: () => McpServer,
): Promise<void> {
  if (req.method !== 'POST') {
    rpcError(res, 405, -32000, 'Method not allowed.');
    return;
  }
  const server = makeServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error('[mcp-http] request failed:', err);
    if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
  }
}
