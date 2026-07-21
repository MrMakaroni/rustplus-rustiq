module.exports = {
  waitFor,
};

function waitFor(timeout, signal) {
  if (signal?.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, timeout);

    function onAbort() {
      clearTimeout(timer);
      reject(abortReason(signal));
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal) {
  return signal.reason || new DOMException('The operation was aborted', 'AbortError');
}
