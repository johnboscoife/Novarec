/**
 * Disk backpressure across ONE take's tracks. When any track falls behind,
 * every track pauses together and they resume together once all have drained.
 * Pausing only the slow track (as each track used to do alone) cut seconds out
 * of the screen while the microphone kept recording, so separate-track exports
 * ran permanently out of sync from that point on.
 */
export class ThrottleGroup {
  private readonly members = new Set<ThrottleMember>();
  private readonly behind = new Set<ThrottleMember>();

  join(member: ThrottleMember): void {
    this.members.add(member);
  }

  leave(member: ThrottleMember): void {
    this.members.delete(member);
    this.release(member);
  }

  /** `member` can't keep up: pause the whole take if it isn't already. */
  request(member: ThrottleMember): void {
    const wasIdle = this.behind.size === 0;
    this.behind.add(member);
    if (wasIdle) this.members.forEach((m) => m.throttle());
  }

  /** `member` has drained: resume the take once nobody is still behind. */
  release(member: ThrottleMember): void {
    if (!this.behind.delete(member) || this.behind.size > 0) return;
    this.members.forEach((m) => m.unthrottle());
  }
}

export interface ThrottleMember {
  throttle(): void;
  unthrottle(): void;
}
