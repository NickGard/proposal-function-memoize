# Proposal: `Function.memoize`

Function memoization is a useful feature in writing performant applications, but there are multiple common implementations that each differ in their usefulness and shortcomings. By having such a feature built in to the language, these differences and shortcomings could be mitigated, and libraries and frameworks would be able to lean on the native implementation rather than ship their own or a third-party one.

## Motivating Use Cases

Memoization is essentially trading storage space for computation speed, since storage is generally plentiful and cheap, and computation is expensive and limited. This isn't always the case, though. There are space-constrained environments (IOT devices, long-running broswer tabs, heavy web applications) where computation is comparatively cheaper.

Many existing implementations limit how much memory a memoized function can use by limiting the cache depth (usually to one level) or expecting the user to define a cache depth at initialization. This practice limits the usefulness and flexibility of memoization. The user doesn't always know how many different sets of arguments (cache depth) they "should" reserve, leading to over- or under-utilization of the reserved memory. In the case of a forced 1-level-cache-depth, the usefulness of memoization is entirely lost if the program switches between two sets of arguments repeatedly.

Implementations that don't limit the cache depth can run out of memory. The cache acts as an ever-growing memory leak, especially as it (usually) strongly references its keys. If the keys are the arguments passed to the memoized function, then any object argument is prevented from being garbage collected.

An implementation I've seen in the wild used `WeakMap`s to store arguments-as-cache-keys but it led to the unfortunate side-effect of users boxing up primitive arguments (e.g. `{value: true}`) because `WeakMap`s can only have objects as keys. Another knock-on effect was nesting memoization techniques in an attempt to not box up primitives:

```javascript
weakMemo(object =>
  _.memoize(boolean =>
    doExpensiveThing(object, boolean)
  )
)
```

Unforturnately, this setup means that the `object` argument is strongly referenced in the closure of the nested function, negating the usefulness of the `weakMemo` (the memoization utility that used `WeakMap`s).

A wishlist of features for a memoization utility is:
* Invisible to users. The function that the user desires to memoize should not have to be modified to be memoized (e.g. boxing primitives)
* Flexible cache. The user should not have to manage the cache. It should grow as needed without user intervention.
* Memory-safe. The user should not have to worry about the memoization cache being a memory leak. No arguments, generated keys (defined by a `hash` function or however), *or* function results should be strongly referenced. This should extend to the memoization function handling excessively large caches. Whether it completely flushes the cache periodically, or removes the least-used key/values, or does some other memory management, this should be invisible to the users beyond a React-style disclaimer that memoization does not guarantee the function won't be re-run.
* User-defined equality between sets of arguments. The user may know when the function should return the same result based on arguments, so they may wish to define a way to determine this. This could be a `hash` function that reduces the set of arguments to a single primitive (probably a string). This could be a `compare` function that compares arguments pairwise for equality (e.g. given the argument sets `a1, a2, a3` and `b1, b2, b3`, the compare function would be called on [`a1, b1`], [`a2, b2`], and [`a3, b3`]) and returns the cached value if they all return true. This could be a `select` function that takes the set of arguments as an input and outputs an iterable of values to use as cache keys (similar to how `React.memo` uses the props passed in to the component).

## Prior Art

### [Lodash.memoize](https://lodash.com/docs/4.17.15#memoize)

Lodash uses only the first argument by default, which can cause collisions in retrieving the correct result. Lodash allows a `resolver` function as an optional second argument to convert the passed arguments into a value to use as the cache key.

I've seen an implementation in the wild that used `JSON.stringify` as the `resolver`. This can fail if any argument isn't stringifiable (like a function), and stringifying can be as slow as whatever the function was that was being memoized.

### [React.memo](https://reactjs.org/docs/react-api.html#reactmemo)

React ships a memoization utility specifically to memoize React components. It builds a cache based on the props passed into the memoized component, relying on referential equality (`===`) unless a second `areEqual` argument is passed in.

The [React documentation](https://reactjs.org/docs/react-api.html#reactmemo) calls out that this utility is a **performance enhancement** and users should not rely on the memoization behavior for any business logic (such as preventing renders or preserving referential equality).

### [React.useMemo](https://reactjs.org/docs/hooks-reference.html#usememo)

React ships a hook that will memoize a value based on a `creator function` (the function that gets memoized) and an array of `dependencies` (values) that act as the memoization keys. In practice this hook only stores one value in cache.

### [Reselect.defaultMemoize](https://github.com/reduxjs/reselect#defaultmemoizefunc-equalitycheck--defaultequalitycheck)

Reselect uses its `defaultMemoize` utility (which it also exposes) in its `createSelector` function. It has a cache size of one and allows a second argument, `equalityCheck`, that will be used to compare the arguments' equality in retrieving its cached value. The `equalityCheck` defaults to a referential equality (`===`) check.

### [lru-memoizer](https://github.com/jfromaniello/lru-memoizer)

`lru-memoizer` has a variable-depth cache (user-defined) that deletes its least-recently-used value. It specializes in retrieving and cacheing asynchronous values. It takes several options, including a `hash` function for turning the arguments into a cache key, and both a `freeze` and `clone` flag for returning frozen (unmodifiable) and cloned (deeply equal but not referentially equal) values.

### [Clojure](http://clojure.github.io/clojure/clojure.core-api.html#clojure.core/memoize)

`Clojure` offeres a memoization utility as a part of its core library.

## Syntax

```javascript
var memoFn = Function.memoize(fn [, options])
```
`fn` is the function to be memoized. (It should be a pure function.)

`options` an object containing any of the following:
* `select` a function that takes all of the arguments passed to the memoized function as inputs and outputs an iterable that serves as the comparison keys to the memoization cache.
* `hash` a function that takes either the arguments passed to the memoized function, or the elements in the iterable returned by `select` if it is also declared, and returns a single value to be used as the comparison key for the memoization cache.
* `compare` a function that takes each key defined by `select` and/or `hash` or the raw arguments as passed to the memoized function (if neither `select` or `hash` are declared) and the corresponding key from memoized calls and outputs `true` if the two keys are equal and `false` otherwise.

**Return**
`memoFn` a new function that wraps the passed function and returns the result of a direct call or a saved value as determined by the memoization algorithm.

### Examples

```javascript
function getIn(target, path, fallback) {
  let steps = [...path];
  let value = target;
  while (steps.length) {
    let step = steps.shift();
    if (!(step in value)) return fallback;
    value = value[step];
  }
  return value;
}

const dog = {
  type: 'dog'
  activities: {
    nap: {
      location: 'rug'
    }
  }
};

// with no options
const memoGetIn = Function.memoize(getIn);

// runs unmemoized
memoGetIn(dog, ['activities', 'nap', 'location'], 'bed');

// returns memoized value
memoGetIn(dog, ['activities', 'nap', 'location'], 'bed');

// runs unmemoized because {...dog} is not equal to dog
memoGetIn({...dog}, ['activities', 'nap', 'location'], 'bed');

function hash(target, path, fallback) {
  return `${target.type}__${path.join('_')}__${fallback}`;
}
const memoGetInHashed = Function.memoize(getIn, {hash});

// runs unmemoized
memoGetInHashed(dog, ['activities', 'nap', 'location'], 'bed');

// returns memoized value
memoGetInHashed(dog, ['activities', 'nap', 'location'], 'bed');

// returns memoized value because the hashes are equal
memoGetInHashed({...dog}, ['activities', 'nap', 'location'], 'bed');

function select(target, path, fallback) {
  // ignore everything about the target except the type
  return [target.type, ...path, fallback];
}
const memoGetInSelected = Function.memoize(getIn, {select});

// runs unmemoized
memoGetInSelected(dog, ['activities', 'nap', 'location'], 'bed');

// returns memoized value
memoGetInSelected(dog, ['activities', 'nap', 'location'], 'bed');

// returns memoized value because the selected keys are equal
memoGetInSelected({...dog}, ['activities', 'nap', 'location'], 'bed');

function compare(a, b) {
  return a === b || ( // referentially equal
    typeof a === 'object' && 
    typeof b === 'object' && 
    a.type === b.type // or have same types
  );
}
const memoGetInByType = Function.memoize(getIn, {compare});

// runs unmemoized
memoGetInByType(dog, ['activities', 'nap', 'location'], 'bed');

// returns memoized value
memoGetInByType(dog, ['activities', 'nap', 'location'], 'bed');

// returns memoized value because {...dog}
// compares as equal to dog
memoGetInByType({...dog}, ['activities', 'nap', 'location'], 'bed');
```

## Polyfill

A polyfill relying on `WeakRef`, `FinalizationRegistry` and `performance.memory` (which don't have great cross-browser compatibility) is located at `./polfill.js`.