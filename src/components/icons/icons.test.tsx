import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArrowLeft, Coffee, Folder, Star, StarOutline } from './index';
import { ICON_SIZES, resolveIconSize } from './metrics';

test('system entities render local FA7 Solid glyphs and lightweight controls use Lucide', () => {
  for (const Component of [Folder, Coffee, Star]) {
    const markup = renderToStaticMarkup(<Component aria-hidden />);
    expect(markup).toContain('data-icon-library="fa7-solid"');
    expect(markup).toContain('width:16px;height:16px');
    expect(markup).not.toContain('http://api.iconify');
  }
  const navigation = renderToStaticMarkup(<ArrowLeft aria-label="Back" />);
  expect(navigation).toContain('data-icon-library="lucide"');
  expect(navigation).toContain('stroke-width="1.75"');
  expect(navigation).toContain('aria-label="Back"');
  expect(renderToStaticMarkup(<StarOutline />)).toContain('fill="none"');
});

test('the shared scale reduces oversized UI glyphs and preserves explicit artwork dimensions', () => {
  expect(resolveIconSize()).toBe(ICON_SIZES.control);
  expect(resolveIconSize(19)).toBe(16);
  expect(resolveIconSize(15)).toBe(14);
  expect(resolveIconSize(11)).toBe(12);
  expect(resolveIconSize(48)).toBe(48);
  expect(renderToStaticMarkup(<Folder size={19} />)).toContain('width:16px;height:16px');
  expect(renderToStaticMarkup(<Folder size={48} />)).toContain('width:48px;height:48px');
});
