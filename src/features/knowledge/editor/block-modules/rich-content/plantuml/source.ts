export const PLANTUML_SOURCE_LIMIT = 50_000;
export const PLANTUML_SVG_LIMIT = 2 * 1024 * 1024;

export function validatePlantUmlSource(source: string): void {
  if (!source.trim() || source.length > PLANTUML_SOURCE_LIMIT) throw new Error('Invalid PlantUML source size');
}

/** The renderer output is displayed as an image, never inserted into the app DOM. */
export function validatePlantUmlSvg(svg: string): string {
  if (!svg || svg.length > PLANTUML_SVG_LIMIT || !/<svg\b[^>]*>/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) throw new Error('Invalid PlantUML image');
  // PlantUML reports parser/include failures as a successful SVG diagnostic.
  // Its version header plus source-location banner distinguishes that image
  // from a real diagram whose ordinary labels happen to discuss errors.
  if (/>PlantUML version [^<]*<\/text>/.test(svg) && /\[From textarea\s*\(line \d+\)\s*\]/.test(svg)) throw new Error('PlantUML source could not be rendered');
  return svg;
}
