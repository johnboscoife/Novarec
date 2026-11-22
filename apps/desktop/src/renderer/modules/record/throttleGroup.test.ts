import { describe, expect, it } from 'vitest';
import { ThrottleGroup, type ThrottleMember } from './throttleGroup.js';

function member(): ThrottleMember & { paused: boolean } {
  return {
    paused: false,
    throttle() {
      this.paused = true;
    },
    unthrottle() {
      this.paused = false;
    },
  };
}

describe('ThrottleGroup', () => {
  it('pauses every track when one falls behind, so tracks stay in sync', () => {
    const group = new ThrottleGroup();
    const screen = member();
    const mic = member();
    group.join(screen);
    group.join(mic);

    group.request(screen);
    expect(screen.paused).toBe(true);
    expect(mic.paused).toBe(true);
  });

  it('resumes only once every track that fell behind has drained', () => {
    const group = new ThrottleGroup();
    const screen = member();
    const camera = member();
    group.join(screen);
    group.join(camera);

    group.request(screen);
    group.request(camera);
    group.release(screen);
    expect(screen.paused).toBe(true); // the camera is still behind
    group.release(camera);
    expect(screen.paused).toBe(false);
    expect(camera.paused).toBe(false);
  });

  it('a stopped track cannot hold the rest of the take paused', () => {
    const group = new ThrottleGroup();
    const screen = member();
    const mic = member();
    group.join(screen);
    group.join(mic);

    group.request(screen);
    group.leave(screen);
    expect(mic.paused).toBe(false);
  });

  it('ignores a release from a track that was never behind', () => {
    const group = new ThrottleGroup();
    const screen = member();
    const mic = member();
    group.join(screen);
    group.join(mic);

    group.request(screen);
    group.release(mic);
    expect(mic.paused).toBe(true);
  });
});
