import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handleStatelessMcp } from '../src/mcp-http.js';

function makeGate() {
  let release!: () => void;
  let enter!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  const entered = new Promise<void>((r) => (enter = r));
  return { release, wait, entered, enter };
}

let slowGate = makeGate();

function makeServer(): McpServer {
  const server = new McpServer({ name: 'test', version: '1.0.0' });
  server.tool('echo', { text: z.string() }, async ({ text }) => ({
    content: [{ type: 'text', text }],
  }));
  server.tool('slow', {}, async () => {
    slowGate.enter();
    await slowGate.wait;
    return { content: [{ type: 'text', text: 'slow-done' }] };
  });
  return server;
}

const servers: Server[] = [];
const clients: Client[] = [];
const OUTAGE_MS = 100;

function listen(port = 0): Promise<Server> {
  const s = createServer((req, res) => {
    if (new URL(req.url ?? '/', 'http://x').pathname === '/mcp') {
      void handleStatelessMcp(req, res, makeServer);
      return;
    }
    res.writeHead(404).end();
  });
  servers.push(s);
  return new Promise((resolve) => s.listen(port, '127.0.0.1', () => resolve(s)));
}

async function stop(s: Server): Promise<void> {
  s.closeAllConnections();
  await new Promise<void>((resolve) => s.close(() => resolve()));
  await new Promise((resolve) => setTimeout(resolve, OUTAGE_MS));
}

function portOf(s: Server): number {
  return (s.address() as AddressInfo).port;
}

async function connect(port: number): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  return client;
}

function textOf(result: unknown): string {
  return (result as { content: { text: string }[] }).content[0].text;
}

afterEach(async () => {
  slowGate.release();
  slowGate = makeGate();
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await Promise.all(servers.splice(0).filter((s) => s.listening).map(stop));
});

test('initialize, tools/list and a call work', async () => {
  const s = await listen();
  const client = await connect(portOf(s));
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((t) => t.name).sort(), ['echo', 'slow']);
  assert.equal(textOf(await client.callTool({ name: 'echo', arguments: { text: 'hi' } })), 'hi');
});

test('two concurrent calls each get their own answer', async () => {
  const s = await listen();
  const client = await connect(portOf(s));
  const [a, b] = await Promise.all([
    client.callTool({ name: 'echo', arguments: { text: 'a' } }),
    client.callTool({ name: 'echo', arguments: { text: 'b' } }),
  ]);
  assert.deepEqual([textOf(a), textOf(b)], ['a', 'b']);
});

test('GET and DELETE /mcp answer 405 with a JSON-RPC error', async () => {
  const s = await listen();
  for (const method of ['GET', 'DELETE']) {
    const res = await fetch(`http://127.0.0.1:${portOf(s)}/mcp`, { method });
    assert.equal(res.status, 405);
    assert.equal((await res.json()).error.code, -32000);
  }
});

test('the same client keeps working after the listener restarts between requests', async () => {
  const first = await listen();
  const port = portOf(first);
  const client = await connect(port);
  assert.equal(textOf(await client.callTool({ name: 'echo', arguments: { text: 'before' } })), 'before');
  await stop(first);
  await listen(port);
  assert.equal(textOf(await client.callTool({ name: 'echo', arguments: { text: 'after' } })), 'after');
});

test('a call in flight during a restart fails and the next call works', async () => {
  const first = await listen();
  const port = portOf(first);
  const client = await connect(port);
  const inFlightFails = assert.rejects(client.callTool({ name: 'slow', arguments: {} }));
  await slowGate.entered;
  await stop(first);
  await inFlightFails;
  await listen(port);
  assert.equal(textOf(await client.callTool({ name: 'echo', arguments: { text: 'next' } })), 'next');
});
