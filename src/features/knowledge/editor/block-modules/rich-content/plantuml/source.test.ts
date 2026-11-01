import { expect, test } from 'bun:test';
import { PLANTUML_SVG_LIMIT, validatePlantUmlSource, validatePlantUmlSvg } from './source';

test('render bounds reject empty and oversized source before loading the engine', () => {
  for (const source of ['', ' \n ', 'x'.repeat(50_001)]) expect(() => validatePlantUmlSource(source)).toThrow();
  expect(() => validatePlantUmlSource('@startuml\nAlice -> Bob : Hello\n@enduml')).not.toThrow();
});
test('accepts an SVG image and bounds malformed or oversized renderer output', () => {
  const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><text>协作流程</text></svg>';
  expect(validatePlantUmlSvg(svg)).toBe(svg);
  for (const output of ['', '<html>Render error</html>', '<svg>', `<svg>${'x'.repeat(PLANTUML_SVG_LIMIT)}</svg>`]) expect(() => validatePlantUmlSvg(output)).toThrow();
});
test('engine syntax diagnostic images are errors rather than successful previews', () => {
  const diagnostic = '<svg><text>PlantUML version 1.2026.9</text><text>[From textarea (line 2) ]</text><text>Syntax Error? (Assumed diagram type: sequence)</text></svg>';
  expect(() => validatePlantUmlSvg(diagnostic)).toThrow('source could not be rendered');
  const diagram = '<svg><text>Syntax Error?</text><text>Handle the failure</text></svg>';
  expect(validatePlantUmlSvg(diagram)).toBe(diagram);
});
