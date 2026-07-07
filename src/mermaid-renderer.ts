// =============================================================================
// mermaid-renderer.ts -- Render Mermaid Diagrams to SVG
//
// Design decisions (PerServeX quality):
//  * htmlLabels:false  -> labels are positioned <text>/<tspan>, NOT <foreignObject>.
//    foreignObject (HTML-in-SVG) shifts/overflows when the SVG is inlined into an
//    HTML report and printed to PDF via Chromium (bug-060); positioned text, laid
//    out by the same Chromium engine mmdc uses to measure, survives the round-trip.
//  * wrappingWidth + padding + spacing -> long node labels wrap instead of being
//    clipped by a too-tight node box (bug-059).
//  * Theme-aware palette: a 'light' PerServeX semantic palette and a 'dark'
//    variant (which Mermaid/PerServeX lack out of the box). Background is
//    always opaque white regardless of palette (see renderSingleDiagram) —
//    for report embedding, leave theme at its 'light' default; 'dark' is kept
//    for non-report-embedding use only, NOT for "matching" a dark report page
//    (that was the bug-032 guidance and is now superseded by the report-SVG
//    light-authored rule, see mermaid-renderer.ts THEME_VARS comment below).
// =============================================================================

import { execFile } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SvgPlotError, type DiagramInput, type DiagramOutput, type Theme } from './types.js';

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Puppeteer config for running Chromium without sandbox (required in Docker as root)
const PUPPETEER_CONFIG_PATH = '/tmp/puppeteer-config.json';
const PUPPETEER_CONFIG = JSON.stringify({
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

let puppeteerConfigWritten = false;

/** Shared layout config — labels as SVG <text>, wrapping for long labels. */
const FLOWCHART = {
  htmlLabels: false,
  useMaxWidth: true,
  padding: 12,
  nodeSpacing: 45,
  rankSpacing: 50,
  wrappingWidth: 200,
  diagramPadding: 8,
} as const;

const FONT_FAMILY = 'Segoe UI, Roboto, Helvetica, Arial, sans-serif';

/**
 * Mermaid themeVariables per color scheme. Background is always opaque white
 * (see renderSingleDiagram's --backgroundColor) — diagrams embedded in reports
 * must be authored as a LIGHT image regardless of the report's own theme;
 * report.html applies a CSS invert filter to adapt light-authored SVGs for
 * dark mode (docs/telegram-html-formatting.md, SVG Diagrams in Reports). A
 * transparent or dark-authored background here would double-adapt under that
 * filter and reproduce the black-on-black / unreadable bug it exists to
 * prevent.
 */
const THEME_VARS: Record<Theme, Record<string, string>> = {
  light: {
    fontFamily: FONT_FAMILY,
    primaryColor: '#E0E7F5',
    primaryTextColor: '#1c2530',
    primaryBorderColor: '#4169E1',
    lineColor: '#5b6877',
    secondaryColor: '#DDEBD8',
    secondaryBorderColor: '#3a8a3a',
    secondaryTextColor: '#1c2530',
    tertiaryColor: '#FBF0DA',
    tertiaryBorderColor: '#C79A2E',
    tertiaryTextColor: '#1c2530',
    clusterBkg: '#f6f8fa',
    clusterBorder: '#c9d3df',
    titleColor: '#1c2530',
    edgeLabelBackground: '#ffffff',
    nodeTextColor: '#1c2530',
  },
  dark: {
    fontFamily: FONT_FAMILY,
    primaryColor: '#1b2b4d',
    primaryTextColor: '#e6edf3',
    primaryBorderColor: '#4169E1',
    lineColor: '#9aa7b4',
    secondaryColor: '#12291b',
    secondaryBorderColor: '#22C55E',
    secondaryTextColor: '#e6edf3',
    tertiaryColor: '#2b220e',
    tertiaryBorderColor: '#F59E0B',
    tertiaryTextColor: '#e6edf3',
    clusterBkg: '#161b22',
    clusterBorder: '#2b333c',
    titleColor: '#e6edf3',
    edgeLabelBackground: '#0f1419',
    nodeTextColor: '#e6edf3',
  },
};

/** Build the mmdc mermaid-config JSON for a color scheme. */
function buildMermaidConfig(theme: Theme): string {
  return JSON.stringify({
    theme: 'base',
    htmlLabels: false,
    flowchart: FLOWCHART,
    themeVariables: THEME_VARS[theme],
  });
}

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
  theme: Theme,
): Promise<DiagramOutput> {
  const hash = createHash('md5').update(`${theme}:${input.mermaid}`).digest('hex').slice(0, 8);
  const inputPath = join(tempDir, `${hash}.mmd`);
  const outputPath = join(tempDir, `${hash}.svg`);
  const configPath = join(tempDir, `${hash}.config.json`);

  try {
    await ensurePuppeteerConfig();
    await writeFile(inputPath, input.mermaid, 'utf-8');
    await writeFile(configPath, buildMermaidConfig(theme), 'utf-8');

    const mmdc = join(__dirname, '..', 'node_modules', '.bin', 'mmdc');
    await execFileAsync(
      mmdc,
      [
        '-i', inputPath,
        '-o', outputPath,
        '-c', configPath,
        '-p', PUPPETEER_CONFIG_PATH,
        '--backgroundColor', '#ffffff',
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
 * @param theme - Color scheme ('light' | 'dark'); defaults to 'light'.
 */
export async function renderDiagrams(
  diagrams: DiagramInput[],
  tempDir: string,
  theme: Theme = 'light',
): Promise<DiagramOutput[]> {
  const results: DiagramOutput[] = [];

  for (const diagram of diagrams) {
    const result = await renderSingleDiagram(diagram, tempDir, theme);
    results.push(result);
  }

  return results;
}
