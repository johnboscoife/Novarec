import { describe, it, expect } from 'vitest';
import { deviceSource, displaySource, windowSource } from './sources.js';

describe('source normalization', () => {
  it('maps a display entry to a display CaptureSource', () => {
    const s = displaySource({ id: 'screen:0:0', name: 'Display 1', displayId: 1 }, 60);
    expect(s).toMatchObject({ id: 'screen:0:0', kind: 'display', targetFps: 60 });
  });

  it('maps a window entry to a window CaptureSource', () => {
    const s = windowSource({ id: 'window:42:0', name: 'Editor' }, 30);
    expect(s.kind).toBe('window');
    expect(s.label).toBe('Editor');
  });

  it('maps media devices by kind and carries the deviceId', () => {
    const cam = deviceSource({ deviceId: 'cam1', label: 'FaceTime HD', kind: 'videoinput' }, 30);
    const mic = deviceSource({ deviceId: 'mic1', label: '', kind: 'audioinput' }, 30);
    expect(cam.kind).toBe('camera');
    expect(cam.deviceId).toBe('cam1');
    expect(mic.kind).toBe('microphone');
    expect(mic.label).toBe('Microphone'); // falls back when label is empty
  });
});
