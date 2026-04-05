// =============================================================================
// types.ts -- SVG Plot MCP Server Type Definitions
// =============================================================================

// -----------------------------------------------------------------------------
// MCP Tool Input/Output
// -----------------------------------------------------------------------------

export interface DiagramInput {
  /** Diagram identifier */
  name: string;
  /** Mermaid diagram source code */
  mermaid: string;
}

export interface DiagramOutput {
  /** Diagram identifier */
  name: string;
  /** Rendered SVG string */
  svg: string;
}

// -----------------------------------------------------------------------------
// Error Types
// -----------------------------------------------------------------------------

export type SvgPlotErrorCode =
  | 'VALIDATION_ERROR'
  | 'MERMAID_RENDER_FAILED'
  | 'INTERNAL_ERROR';

export class SvgPlotError extends Error {
  constructor(
    public readonly code: SvgPlotErrorCode,
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'SvgPlotError';
  }
}
