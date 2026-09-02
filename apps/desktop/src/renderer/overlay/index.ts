import './overlay.css';
import { clampRectToBounds, snapRectEdges } from '@novarec/capture';
import type { DisplayInfo, Rect } from '@novarec/shared';

/**
 * The region-selection overlay, one instance per display.
 *
 * Because this window covers exactly one monitor, 1 CSS pixel here is exactly
 * 1 DIP of that monitor: pointer coordinates need no scaling, and the rect is
 * reported local to the display. Main adds the display origin. (The previous
 * single window spanning the virtual desktop could not do this — Windows clamped
 * it to one screen, and a straddling window's CSS pixels stop matching DIP.)
 */
interface OverlayInit {
  display: DisplayInfo;
}

interface OverlayApi {
  onInit(callback: (data: OverlayInit) => void): void;
  onClear(callback: () => void): void;
  begin(): void;
  confirm(displayId: number, rect: Rect): void;
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

let display: DisplayInfo | null = null;
let dragging = false;
let anchor = { x: 0, y: 0 };
let current: Rect | null = null;

window.overlay.onInit((data) => {
  display = data.display;
  // Name the monitor while more than one overlay is up, so it's obvious which
  // screen a selection will come from.
  hint.textContent = display.label
    ? `${display.label} · Drag to select · Enter to confirm · Esc to cancel`
    : 'Drag to select · Enter to confirm · Esc to cancel';
});

// A drag started on another display's overlay: this one is no longer the
// selection, so drop it.
window.overlay.onClear(() => {
  dragging = false;
  current = null;
  toolbar.style.display = 'none';
  render();
});

/**
 * The drawable area, in CSS pixels. This is the source of truth for clamping —
 * never the display bounds — so a selection can never extend past what the user
 * was actually shown, even if the window ended up smaller than its monitor.
 */
function viewport(): Rect {
  return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
}

backdrop.addEventListener('pointerdown', (e) => {
  dragging = true;
  anchor = { x: e.clientX, y: e.clientY };
  current = { x: anchor.x, y: anchor.y, width: 0, height: 0 };
  toolbar.style.display = 'none';
  window.overlay.begin();
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
  const view = viewport();
  const bounded = clampRectToBounds(raw, view);
  // Snap to this display's own edges only — the guides are the viewport edges.
  current = snapRectEdges(bounded, [0, view.width], [0, view.height], SNAP_THRESHOLD);
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
  if (!display || !current) return;
  if (current.width < MIN_SIZE || current.height < MIN_SIZE) return;
  // Local CSS pixels == this display's DIP; main adds the display origin.
  window.overlay.confirm(display.id, current);
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

  // Dimensions label: DIP size plus the physical-pixel size on this display.
  const scale = display ? display.scaleFactor : 1;
  dims.textContent = `${Math.round(width)} × ${Math.round(height)}  ·  ${Math.round(
    width * scale,
  )} × ${Math.round(height * scale)} px`;
  dims.style.display = 'block';
  dims.style.left = `${x}px`;
  dims.style.top = `${Math.max(0, y - 26)}px`;
}

function showToolbar(): void {
  if (!current) return;
  const view = viewport();
  toolbar.style.display = 'flex';
  toolbar.style.left = `${Math.min(current.x, Math.max(0, view.width - 150))}px`;
  toolbar.style.top = `${Math.min(view.height - 34, current.y + current.height + 8)}px`;
}

function el(tag: string, id: string): HTMLElement {
  const node = document.createElement(tag);
  node.id = id;
  return node;
}
