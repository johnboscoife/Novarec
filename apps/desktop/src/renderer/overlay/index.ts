import './overlay.css';
import { clampRectToBounds, displayForRect, snapRectEdges } from '@novarec/capture';
import type { DisplayInfo, Rect } from '@novarec/shared';

interface OverlayInit {
  displays: DisplayInfo[];
  virtualBounds: Rect;
}

interface OverlayApi {
  onInit(callback: (data: OverlayInit) => void): void;
  confirm(rect: Rect): void;
  cancel(): void;
}

declare global {
  interface Window {
    overlay: OverlayApi;
  }
}

const SNAP_THRESHOLD = 8;
const MIN_SIZE = 8;

const root = document.getElementById('overlay-root');
if (!root) throw new Error('overlay-root missing');

const backdrop = el('div', 'backdrop');
const selection = el('div', 'selection');
const dims = el('div', 'dims');
const hint = el('div', 'hint');
hint.textContent = 'Drag to select · Enter to confirm · Esc to cancel';
const toolbar = el('div', 'toolbar');
const confirmBtn = document.createElement('button');
confirmBtn.className = 'tb-confirm';
confirmBtn.textContent = 'Capture';
const cancelBtn = document.createElement('button');
cancelBtn.className = 'tb-cancel';
cancelBtn.textContent = 'Cancel';
toolbar.append(confirmBtn, cancelBtn);
root.append(backdrop, selection, dims, hint, toolbar);

let virtualBounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
let displays: DisplayInfo[] = [];
let xGuides: number[] = [];
let yGuides: number[] = [];
let dragging = false;
let anchor = { x: 0, y: 0 };
let current: Rect | null = null;

window.overlay.onInit((data) => {
  virtualBounds = data.virtualBounds;
  displays = data.displays;
  // Snap guides in overlay-local coordinates (window origin = virtualBounds).
  xGuides = displays.flatMap((d) => [
    d.bounds.x - virtualBounds.x,
    d.bounds.x - virtualBounds.x + d.bounds.width,
  ]);
  yGuides = displays.flatMap((d) => [
    d.bounds.y - virtualBounds.y,
    d.bounds.y - virtualBounds.y + d.bounds.height,
  ]);
});

backdrop.addEventListener('pointerdown', (e) => {
  dragging = true;
  anchor = { x: e.clientX, y: e.clientY };
  current = { x: anchor.x, y: anchor.y, width: 0, height: 0 };
  toolbar.style.display = 'none';
  render();
});

window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const raw: Rect = {
    x: Math.min(anchor.x, e.clientX),
    y: Math.min(anchor.y, e.clientY),
    width: Math.abs(e.clientX - anchor.x),
    height: Math.abs(e.clientY - anchor.y),
  };
  const bounded = clampRectToBounds(raw, {
    x: 0,
    y: 0,
    width: virtualBounds.width,
    height: virtualBounds.height,
  });
  current = snapRectEdges(bounded, xGuides, yGuides, SNAP_THRESHOLD);
  render();
});

window.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  if (!current || current.width < MIN_SIZE || current.height < MIN_SIZE) {
    current = null;
    render();
    return;
  }
  showToolbar();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.overlay.cancel();
  if (e.key === 'Enter') confirmSelection();
});
confirmBtn.addEventListener('click', confirmSelection);
cancelBtn.addEventListener('click', () => window.overlay.cancel());

function confirmSelection(): void {
  if (!current || current.width < MIN_SIZE || current.height < MIN_SIZE) return;
  // Local overlay coords -> virtual-desktop DIP coords.
  window.overlay.confirm({
    x: virtualBounds.x + current.x,
    y: virtualBounds.y + current.y,
    width: current.width,
    height: current.height,
  });
}

function render(): void {
  if (!current) {
    selection.style.display = 'none';
    dims.style.display = 'none';
    return;
  }
  const { x, y, width, height } = current;
  selection.style.display = 'block';
  selection.style.left = `${x}px`;
  selection.style.top = `${y}px`;
  selection.style.width = `${width}px`;
  selection.style.height = `${height}px`;

  // Dimensions label: DIP size plus the physical-pixel size on the owning display.
  const virtualRect: Rect = { x: virtualBounds.x + x, y: virtualBounds.y + y, width, height };
  const owner = displayForRect(displays, virtualRect);
  const scale = owner ? owner.scaleFactor : 1;
  dims.textContent = `${Math.round(width)} × ${Math.round(height)}  ·  ${Math.round(
    width * scale,
  )} × ${Math.round(height * scale)} px`;
  dims.style.display = 'block';
  dims.style.left = `${x}px`;
  dims.style.top = `${Math.max(0, y - 26)}px`;
}

function showToolbar(): void {
  if (!current) return;
  toolbar.style.display = 'flex';
  toolbar.style.left = `${current.x}px`;
  toolbar.style.top = `${Math.min(virtualBounds.height - 34, current.y + current.height + 8)}px`;
}

function el(tag: string, id: string): HTMLElement {
  const node = document.createElement(tag);
  node.id = id;
  return node;
}
