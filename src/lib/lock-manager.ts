// @ts-nocheck
class LockManager {
  constructor() {
    this.locks = new Map();
  }

  run(key, task) {
    const previous = this.locks.get(key) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.locks.get(key) === next) {
          this.locks.delete(key);
        }
      });

    this.locks.set(key, next);
    return next;
  }
}

export { LockManager };
