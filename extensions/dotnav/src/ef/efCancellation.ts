/** Stop waiting for a UI choice when its owning EF operation is cancelled. */
export function waitForEfChoice<T>(choice: PromiseLike<T>, signal?: AbortSignal): Promise<T | undefined> {
  if (signal?.aborted) {
    return Promise.resolve(undefined);
  }
  return new Promise(resolve => {
    const abort = () => finish(undefined);
    const finish = (value: T | undefined) => {
      signal?.removeEventListener('abort', abort);
      resolve(value);
    };
    signal?.addEventListener('abort', abort, { once: true });
    // A late response must not restart a cancelled operation.
    void Promise.resolve(choice).then(finish, () => finish(undefined));
  });
}
