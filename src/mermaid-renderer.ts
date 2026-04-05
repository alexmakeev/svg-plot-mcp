// =============================================================================
// mermaid-renderer.ts -- Render Mermaid Diagrams to SVG
// =============================================================================

import { execFile } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SvgPlotError, type DiagramInput, type DiagramOutput } from './types.js';

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Puppeteer config for running Chromium without sandbox (required in Docker as root)
const PUPPETEER_CONFIG_PATH = '/tmp/puppeteer-config.json';
const PUPPETEER_CONFIG = JSON.stringify({
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

let puppeteerConfigWritten = false;

/**
 * Ensure the puppeteer config file exists on disk.
 * Written once at first render, reused for all subsequent renders.
 */
async function ensurePuppeteerConfig(): Promise<void> {
  if (puppeteerConfigWritten) return;
  await writeFile(PUPPETEER_CONFIG_PATH, PUPPETEER_CONFIG, 'utf-8');
  puppeteerConfigWritten = true;
}

/**
 * Render a single Mermaid diagram to SVG.
 */
async function renderSingleDiagram(
  input: DiagramInput,
  tempDir: string,
): Promise<DiagramOutput> {
  const hash = createHash('md5').update(input.mermaid).digest('hex').slice(0, 8);
  const inputPath = join(tempDir, `${hash}.mmd`);
  const outputPath = join(tempDir, `${hash}.svg`);

  try {
    await ensurePuppeteerConfig();
    await writeFile(inputPath, input.mermaid, 'utf-8');

    const mmdc = join(__dirname, '..', 'node_modules', '.bin', 'mmdc');
    await execFileAsync(
      mmdc,
      [
        '-i', inputPath,
        '-o', outputPath,
        '-t', 'neutral',
        '-p', PUPPETEER_CONFIG_PATH,
        '--backgroundColor', 'transparent',
      ],
      { timeout: 30_000 },
    );

    const svg = await readFile(outputPath, 'utf-8');
    return { name: input.name, svg };
  } catch (err) {
    throw new SvgPlotError(
      'MERMAID_RENDER_FAILED',
      `Failed to render diagram "${input.name}": ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err : undefined,
    );
  }
}

/**
 * Render an array of Mermaid diagrams to SVG.
 */
export async function renderDiagrams(
  diagrams: DiagramInput[],
  tempDir: string,
): Promise<DiagramOutput[]> {
  const results: DiagramOutput[] = [];

  for (const diagram of diagrams) {
    const result = await renderSingleDiagram(diagram, tempDir);
    results.push(result);
  }

  return results;
}
