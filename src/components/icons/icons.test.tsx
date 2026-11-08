import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArrowLeft, Coffee, Folder, GenerateStar, MagnifyingGlass, Moon, ShapesOutline, Star, StarOutline } from './index';
import { ICON_SIZES, resolveIconSize } from './metrics';

test('system entities render local FA7 Solid glyphs and lightweight controls use Lucide', () => {
  for (const Component of [Folder, Coffee, Star, MagnifyingGlass, Moon]) {
    const markup = renderToStaticMarkup(<Component aria-hidden />);
    expect(markup).toContain('data-icon-library="fa7-solid"');
    expect(markup).toContain('width:14px;height:14px');
    expect(markup).not.toContain('http://api.iconify');
  }
  const navigation = renderToStaticMarkup(<ArrowLeft aria-label="Back" />);
  expect(navigation).toContain('data-icon-library="lucide"');
  expect(navigation).toContain('stroke-width="1.75"');
  expect(navigation).toContain('aria-label="Back"');
  expect(renderToStaticMarkup(<StarOutline />)).toContain('fill="none"');
});

test('the shared renderer reduces every numeric glyph one step without resizing its control', () => {
  expect(resolveIconSize()).toBe(14);
  expect(resolveIconSize(ICON_SIZES.control)).toBe(14);
  expect(resolveIconSize(ICON_SIZES.compact)).toBe(12);
  expect(resolveIconSize(ICON_SIZES.indicator)).toBe(10);
  expect(resolveIconSize(19)).toBe(14);
  expect(resolveIconSize(15)).toBe(12);
  expect(resolveIconSize(11)).toBe(10);
  expect(resolveIconSize(48)).toBe(46);
  expect(renderToStaticMarkup(<Folder size={19} />)).toContain('width:14px;height:14px');
  expect(renderToStaticMarkup(<Folder size={48} />)).toContain('width:46px;height:46px');
});

test('AI glyphs share the standard optical box and the four-shape reference uses official components', () => {
  const generation = renderToStaticMarkup(<GenerateStar size={16} aria-hidden />);
  const visualization = renderToStaticMarkup(<ShapesOutline size={16} aria-hidden />);
  expect(generation).toContain('data-icon-library="fob-reference"');
  expect(generation).toContain('data-icon="generate-star"');
  expect(generation).toContain('width:14px;height:14px');
  expect(visualization).toContain('width:14px;height:14px');
  expect(visualization).toContain('data-icon-composition="four-shapes"');
  expect(visualization.match(/<svg\b/g)).toHaveLength(4);
  for (const name of ['diamond', 'circle', 'triangle', 'square']) expect(visualization).toContain(`lucide-${name}`);
  // 7/16-cell sizing × 4px source stroke = the full icon's 1.75px stroke.
  expect(visualization.match(/stroke-width="4"/g)).toHaveLength(4);
});
