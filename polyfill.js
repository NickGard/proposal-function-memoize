function MemoryObserver(callback) {
  if (!new.target) {
    throw new TypeError("calling MemoryObserver without new is forbidden");
  }

  let cancelToken;

  function notify() {
    // jsHeapSizeLimit
    // totalJSHeapSize
    // usedJSHeapSize
    callback(performance.memory);

    // check again later
    cancelToken = window.requestIdleCallback(notify, {
      timeout: 500
    });
  }

  this.disconnect = () => window.cancelIdleCallback(cancelToken);
  this.observe = notify;
  this.takeRecords = () => [performance.memory];
}

Function.memoize = (function() {
  const NO_VALUE = Symbol("NO_VALUE");
  const cacheInstances = new Set();
  let isSystemMemoryConstrained = false;

  const memoryObserver = new MemoryObserver(
    ({ jsHeapSizeLimit, usedJSHeapSize } = {}) => {
      const shouldBeConstrained = usedJSHeapSize / jsHeapSizeLimit >= 0.8;
      if (shouldBeConstrained && !isSystemMemoryConstrained) {
        flushCaches();
      }
      isSystemMemoryConstrained = shouldBeConstrained;
    }
  );

  function flushCaches() {
    cacheInstances.forEach(wrappedCacheInstance => {
      const cacheInstance = wrappedCacheInstance.deref();
      if (!cacheInstance) {
        cacheInstances.delete(cacheInstance); // remove empty wrappers
      } else {
        cacheInstance = createNode(); // effectively delete the entire cache
      }
    });
  }

  memoryObserver.observe();

  const registry = new FinalizationRegistry(function schedulePruning(
    cacheInstance
  ) {
    // An object key in the cacheInstance has been Garbage Collected.
    // Schedule a cleanup of the cache at the next idle period.
    window.requestIdleCallback(() => pruneNodeCache(cacheInstance));
  });

  // remove all branches that are keyed off of empty (GC'd) WeakRefs
  function pruneNodeCache(nodeCache) {
    const cache = nodeCache.deref();
    if (!cache) return; // the node no longer exists
    for (const [k, v] of cache.entries()) {
      if (isWeakRef(k) && !k.deref()) {
        cache.delete(k);
      }
    }
  }

  function isWeakRef(wr) {
    return Object.prototype.toString.call(wr).slice(8, -1) === "WeakRef";
  }
  function isNonNullObject(o) {
    return o !== null && typeof o === "object";
  }

  function createNode() {
    const node = {
      cache: new Map(),
      value: NO_VALUE
    };
    return node;
  }

  function getNode(node, key, compare) {
    for (const [k, nextNode] of node.cache.entries()) {
      const _key = isWeakRef(k) ? k.deref() : k;
      if (compare(_key, key)) {
        return nextNode;
      }
    }
    return null;
  }

  function getValueAt(node, compare, ...keys) {
    let currentNode = node;
    while (keys.length) {
      currentNode = getNode(currentNode, keys.shift(), compare);
      if (currentNode === null) {
        return NO_VALUE;
      }
    }

    // unbox value
    return isWeakRef(currentNode.value)
      ? currentNode.value.deref()
      : currentNode.value;
  }

  function setValueAt(node, compare, value, ...keys) {
    let currentNode = node;

    // traverse to the leaf node
    while (keys.length) {
      let key = keys.shift();
      let nextNode = getNode(currentNode, key, compare);

      if (nextNode === null) {
        nextNode = createNode();
        if (isNonNullObject(key)) {
          registry.register(key, new WeakRef(currentNode.cache));
          key = new WeakRef(key);
        }
        currentNode.cache.set(key, nextNode);
      }

      currentNode = nextNode;
    }

    currentNode.value = isNonNullObject(value) ? new WeakRef(value) : value;
  }

  function referenitalEquality(a, b) {
    return a === b;
  }

  return function(fn, opts) {
    const rootNode = createNode();
    const hash = opts && typeof opts.hash === "function" ? opts.hash : null;
    const select =
      opts && typeof opts.select === "function" ? opts.select : null;
    const compare =
      opts && typeof opts.compare === "function"
        ? opts.compare
        : referenitalEquality;

    cacheInstances.add(new WeakRef(rootNode));

    return function() {
      const keys =
        hash && select
          ? [hash(select(...arguments))]
          : hash
          ? [hash(...arguments)]
          : select
          ? select(...arguments)
          : arguments;
      let value = getValueAt(rootNode, compare, ...keys);
      if (value === NO_VALUE) {
        value = fn.apply(null, arguments);
        if (isSystemMemoryConstrained) {
          // in a constrained environment, only store the last set of arguments
          rootNode = createNode();
        }
        setValueAt(rootNode, compare, value, ...keys);
      }
      return value;
    };
  };
})();
