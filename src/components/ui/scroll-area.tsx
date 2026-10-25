"use client";

import { CaretLeftSolid, CaretRightSolid, CaretUpSolid, CaretDownSolid } from '@/components/icons';
import { useEffect, useRef, useState, type ComponentPropsWithoutRef, type ElementType, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { cn } from "@/lib/utils";
import { usePageScrollKey } from '@/lib/page-session-state';

const THUMB_MIN = 48;
const THUMB_MAX = 128;
const THUMB_VIEWPORT_RATIO = 0.2;
const ARROW_SIZE = 14;
const SCROLL_STEP = 64;
const ENDPOINT_EPSILON = 2;

/* 滑块长度只依赖视口尺寸（不依赖可滚动总高度）：视口越大滑块越长，小滚动区自动缩短，并夹在上下限之间。 */
function thumbLength(viewport: number) {
  return Math.round(Math.min(Math.max(viewport * THUMB_VIEWPORT_RATIO, THUMB_MIN), THUMB_MAX));
}

/* 全局唯一滚动条实现：原生滑块长度由内容比例决定、无法调短，且原生滚动条已全局隐藏，
   因此自绘完整滚动条（上下/左右步进箭头 + 自适应短滑块），配色与整体边框令牌一致，支持拖拽。 */
type ScrollAreaProps = ComponentPropsWithoutRef<"div"> & {
  viewportClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  orientation?: "vertical" | "horizontal";
  scrollbar?: boolean;
  as?: ElementType;
  restorationKey?: string;
};

export function ScrollArea({ children, className, viewportClassName, viewportRef, orientation = "vertical", scrollbar = true, as: Tag = "div", restorationKey, ...props }: ScrollAreaProps) {
  const scrollKey = usePageScrollKey(restorationKey);
  const horizontal = orientation === "horizontal";
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; start: number; startScroll: number } | null>(null);
  const stepTimerRef = useRef<number | null>(null);
  const [thumb, setThumb] = useState({ visible: false, offset: 0, travel: 0, size: THUMB_MIN, atStart: true, atEnd: false });

  function syncThumb() {
    const element = scrollRef.current;
    if (!element) return;
    const viewport = horizontal ? element.clientWidth : element.clientHeight;
    const maxScroll = horizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
    const track = Math.max(viewport - ARROW_SIZE * 2, 0);
    const size = Math.min(thumbLength(viewport), track);
    const travel = Math.max(track - size, 0);
    const visible = maxScroll > 1 && travel > 0;
    // 浏览器缩放、平滑滚动可能让端点停在 0.x～1.x 的亚像素位置。
    // 先归一化，再以小容差判定端点，避免到顶后上箭头仍保持弱态。
    const rawPos = horizontal ? element.scrollLeft : element.scrollTop;
    const pos = Math.min(Math.max(rawPos, 0), maxScroll);
    const atStart = pos <= ENDPOINT_EPSILON;
    const atEnd = maxScroll - pos <= ENDPOINT_EPSILON;
    const offset = visible ? (pos / maxScroll) * travel : 0;
    setThumb((current) =>
      current.visible === visible && current.size === size && current.atStart === atStart && current.atEnd === atEnd && Math.abs(current.offset - offset) < 0.5
        ? current
        : { visible, offset, travel, size, atStart, atEnd },
    );
  }

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    syncThumb();
    const resizeObserver = new ResizeObserver(syncThumb);
    const observeChildren = () => Array.from(element.children).forEach((child) => resizeObserver.observe(child));
    resizeObserver.observe(element);
    observeChildren();
    const mutationObserver = new MutationObserver(() => {
      resizeObserver.disconnect();
      resizeObserver.observe(element);
      observeChildren();
      syncThumb();
    });
    mutationObserver.observe(element, { childList: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      stopStepScroll();
    };
    // syncThumb 为每次渲染重建的稳定同步函数，无需作为依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizontal]);

  function startStepScroll(direction: 1 | -1, event: ReactPointerEvent<HTMLDivElement>) {
    const element = scrollRef.current;
    if (!element) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const step = () => element.scrollBy(horizontal ? { left: direction * SCROLL_STEP } : { top: direction * SCROLL_STEP });
    step();
    stopStepScroll();
    stepTimerRef.current = window.setInterval(step, 100);
  }

  function stopStepScroll() {
    if (stepTimerRef.current !== null) {
      window.clearInterval(stepTimerRef.current);
      stepTimerRef.current = null;
    }
  }

  function handleThumbPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const element = scrollRef.current;
    if (!element) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      start: horizontal ? event.clientX : event.clientY,
      startScroll: horizontal ? element.scrollLeft : element.scrollTop,
    };
  }

  function handleThumbPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const element = scrollRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !element || thumb.travel < 1) return;
    const maxScroll = horizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight;
    if (maxScroll < 1) return;
    const delta = ((horizontal ? event.clientX : event.clientY) - drag.start) / thumb.travel;
    const next = drag.startScroll + delta * maxScroll;
    if (horizontal) element.scrollLeft = next;
    else element.scrollTop = next;
  }

  function endThumbDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  const thumbStyle = horizontal
    ? { width: thumb.size, transform: `translateX(${thumb.offset}px)` }
    : { height: thumb.size, transform: `translateY(${thumb.offset}px)` };

  /* 抵达对应端点时清晰显示该端箭头，既提示当前位置，也避免在浅色主题中被误认为消失。 */
  function arrowClass(active: boolean) {
    return cn(
      "cursor-pointer items-center justify-center transition-colors duration-150 hover:bg-surface-hover hover:text-ink",
      active ? "text-ink-secondary" : "text-ink-faint/40",
    );
  }

  return (
    <Tag className={cn("relative", className)} {...props}>
      <div
        data-page-scroll={scrollKey}
        ref={(node) => {
          scrollRef.current = node;
          if (typeof viewportRef === "function") viewportRef(node);
          else if (viewportRef) viewportRef.current = node;
        }}
        onScroll={syncThumb}
        className={cn(horizontal ? "w-full max-w-[inherit] overflow-x-auto" : "h-full max-h-[inherit] overflow-y-auto", viewportClassName)}
      >
        {children}
      </div>
      {scrollbar && thumb.visible ? (
        <div
          aria-hidden="true"
          /* z-20：覆盖式滚动条须绘制在滚动内容（含其中的定位元素）之上。 */
          className={cn("absolute z-20 flex", horizontal ? "inset-x-0 bottom-0 h-3 flex-row" : "inset-y-0 right-0 w-3 flex-col")}
        >
          {horizontal ? (
            <>
              <div
                className={cn("flex h-3 w-3.5", arrowClass(thumb.atStart))}
                onPointerDown={(event) => startStepScroll(-1, event)}
                onPointerUp={stopStepScroll}
                onPointerCancel={stopStepScroll}
              >
                <CaretLeftSolid size={12} />
              </div>
              <div className="relative min-w-0 flex-1">
                <div
                  className="group absolute inset-y-0 left-0 flex h-3 cursor-grab active:cursor-grabbing touch-none select-none items-center"
                  style={thumbStyle}
                  onPointerDown={handleThumbPointerDown}
                  onPointerMove={handleThumbPointerMove}
                  onPointerUp={endThumbDrag}
                  onPointerCancel={endThumbDrag}
                >
                  <span className="h-1.5 w-full rounded-full bg-border-strong transition-colors group-hover:bg-ink-faint" />
                </div>
              </div>
              <div
                className={cn("flex h-3 w-3.5", arrowClass(thumb.atEnd))}
                onPointerDown={(event) => startStepScroll(1, event)}
                onPointerUp={stopStepScroll}
                onPointerCancel={stopStepScroll}
              >
                <CaretRightSolid size={12} />
              </div>
            </>
          ) : (
            <>
              <div
                className={cn("flex h-3.5 w-3", arrowClass(thumb.atStart))}
                onPointerDown={(event) => startStepScroll(-1, event)}
                onPointerUp={stopStepScroll}
                onPointerCancel={stopStepScroll}
              >
                <CaretUpSolid size={12} />
              </div>
              <div className="relative min-h-0 flex-1">
                <div
                  className="group absolute inset-x-0 top-0 flex w-3 cursor-grab active:cursor-grabbing touch-none select-none items-center justify-center"
                  style={thumbStyle}
                  onPointerDown={handleThumbPointerDown}
                  onPointerMove={handleThumbPointerMove}
                  onPointerUp={endThumbDrag}
                  onPointerCancel={endThumbDrag}
                >
                  <span className="h-full w-1.5 rounded-full bg-border-strong transition-colors group-hover:bg-ink-faint" />
                </div>
              </div>
              <div
                className={cn("flex h-3.5 w-3", arrowClass(thumb.atEnd))}
                onPointerDown={(event) => startStepScroll(1, event)}
                onPointerUp={stopStepScroll}
                onPointerCancel={stopStepScroll}
              >
                <CaretDownSolid size={12} />
              </div>
            </>
          )}
        </div>
      ) : null}
    </Tag>
  );
}
