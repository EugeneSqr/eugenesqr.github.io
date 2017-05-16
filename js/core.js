(function(global){

//
// Check for native Promise and it has correct interface
//

var NativePromise = global['Promise'];
var nativePromiseSupported =
  NativePromise &&
  // Some of these methods are missing from
  // Firefox/Chrome experimental implementations
  'resolve' in NativePromise &&
  'reject' in NativePromise &&
  'all' in NativePromise &&
  'race' in NativePromise &&
  // Older version of the spec had a resolver object
  // as the arg rather than a function
  (function(){
    var resolve;
    new NativePromise(function(r){ resolve = r; });
    return typeof resolve === 'function';
  })();


//
// export if necessary
//

if (typeof exports !== 'undefined' && exports)
{
  // node.js
  exports.Promise = nativePromiseSupported ? NativePromise : Promise;
  exports.Polyfill = Promise;
}
else
{
  // AMD
  if (typeof define == 'function' && define.amd)
  {
    define(function(){
      return nativePromiseSupported ? NativePromise : Promise;
    });
  }
  else
  {
    // in browser add to global
    if (!nativePromiseSupported)
      global['Promise'] = Promise;
  }
}


//
// Polyfill
//

var PENDING = 'pending';
var SEALED = 'sealed';
var FULFILLED = 'fulfilled';
var REJECTED = 'rejected';
var NOOP = function(){};

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

// async calls
var asyncSetTimer = typeof setImmediate !== 'undefined' ? setImmediate : setTimeout;
var asyncQueue = [];
var asyncTimer;

function asyncFlush(){
  // run promise callbacks
  for (var i = 0; i < asyncQueue.length; i++)
    asyncQueue[i][0](asyncQueue[i][1]);

  // reset async asyncQueue
  asyncQueue = [];
  asyncTimer = false;
}

function asyncCall(callback, arg){
  asyncQueue.push([callback, arg]);

  if (!asyncTimer)
  {
    asyncTimer = true;
    asyncSetTimer(asyncFlush, 0);
  }
}


function invokeResolver(resolver, promise) {
  function resolvePromise(value) {
    resolve(promise, value);
  }

  function rejectPromise(reason) {
    reject(promise, reason);
  }

  try {
    resolver(resolvePromise, rejectPromise);
  } catch(e) {
    rejectPromise(e);
  }
}

function invokeCallback(subscriber){
  var owner = subscriber.owner;
  var settled = owner.state_;
  var value = owner.data_;  
  var callback = subscriber[settled];
  var promise = subscriber.then;

  if (typeof callback === 'function')
  {
    settled = FULFILLED;
    try {
      value = callback(value);
    } catch(e) {
      reject(promise, e);
    }
  }

  if (!handleThenable(promise, value))
  {
    if (settled === FULFILLED)
      resolve(promise, value);

    if (settled === REJECTED)
      reject(promise, value);
  }
}

function handleThenable(promise, value) {
  var resolved;

  try {
    if (promise === value)
      throw new TypeError('A promises callback cannot return that same promise.');

    if (value && (typeof value === 'function' || typeof value === 'object'))
    {
      var then = value.then;  // then should be retrived only once

      if (typeof then === 'function')
      {
        then.call(value, function(val){
          if (!resolved)
          {
            resolved = true;

            if (value !== val)
              resolve(promise, val);
            else
              fulfill(promise, val);
          }
        }, function(reason){
          if (!resolved)
          {
            resolved = true;

            reject(promise, reason);
          }
        });

        return true;
      }
    }
  } catch (e) {
    if (!resolved)
      reject(promise, e);

    return true;
  }

  return false;
}

function resolve(promise, value){
  if (promise === value || !handleThenable(promise, value))
    fulfill(promise, value);
}

function fulfill(promise, value){
  if (promise.state_ === PENDING)
  {
    promise.state_ = SEALED;
    promise.data_ = value;

    asyncCall(publishFulfillment, promise);
  }
}

function reject(promise, reason){
  if (promise.state_ === PENDING)
  {
    promise.state_ = SEALED;
    promise.data_ = reason;

    asyncCall(publishRejection, promise);
  }
}

function publish(promise) {
  var callbacks = promise.then_;
  promise.then_ = undefined;

  for (var i = 0; i < callbacks.length; i++) {
    invokeCallback(callbacks[i]);
  }
}

function publishFulfillment(promise){
  promise.state_ = FULFILLED;
  publish(promise);
}

function publishRejection(promise){
  promise.state_ = REJECTED;
  publish(promise);
}

/**
* @class
*/
function Promise(resolver){
  if (typeof resolver !== 'function')
    throw new TypeError('Promise constructor takes a function argument');

  if (this instanceof Promise === false)
    throw new TypeError('Failed to construct \'Promise\': Please use the \'new\' operator, this object constructor cannot be called as a function.');

  this.then_ = [];

  invokeResolver(resolver, this);
}

Promise.prototype = {
  constructor: Promise,

  state_: PENDING,
  then_: null,
  data_: undefined,

  then: function(onFulfillment, onRejection){
    var subscriber = {
      owner: this,
      then: new this.constructor(NOOP),
      fulfilled: onFulfillment,
      rejected: onRejection
    };

    if (this.state_ === FULFILLED || this.state_ === REJECTED)
    {
      // already resolved, call callback async
      asyncCall(invokeCallback, subscriber);
    }
    else
    {
      // subscribe
      this.then_.push(subscriber);
    }

    return subscriber.then;
  },

  'catch': function(onRejection) {
    return this.then(null, onRejection);
  }
};

Promise.all = function(promises){
  var Class = this;

  if (!isArray(promises))
    throw new TypeError('You must pass an array to Promise.all().');

  return new Class(function(resolve, reject){
    var results = [];
    var remaining = 0;

    function resolver(index){
      remaining++;
      return function(value){
        results[index] = value;
        if (!--remaining)
          resolve(results);
      };
    }

    for (var i = 0, promise; i < promises.length; i++)
    {
      promise = promises[i];

      if (promise && typeof promise.then === 'function')
        promise.then(resolver(i), reject);
      else
        results[i] = promise;
    }

    if (!remaining)
      resolve(results);
  });
};

Promise.race = function(promises){
  var Class = this;

  if (!isArray(promises))
    throw new TypeError('You must pass an array to Promise.race().');

  return new Class(function(resolve, reject) {
    for (var i = 0, promise; i < promises.length; i++)
    {
      promise = promises[i];

      if (promise && typeof promise.then === 'function')
        promise.then(resolve, reject);
      else
        resolve(promise);
    }
  });
};

Promise.resolve = function(value){
  var Class = this;

  if (value && typeof value === 'object' && value.constructor === Class)
    return value;

  return new Class(function(resolve){
    resolve(value);
  });
};

Promise.reject = function(reason){
  var Class = this;

  return new Class(function(resolve, reject){
    reject(reason);
  });
};

})(typeof window != 'undefined' ? window : typeof global != 'undefined' ? global : typeof self != 'undefined' ? self : this);

/*
 * SystemJS v0.20.12 Dev
 */
(function () {
'use strict';

/*
 * Environment
 */
var isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
var isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
var isWindows = typeof process !== 'undefined' && typeof process.platform === 'string' && process.platform.match(/^win/);

var envGlobal = typeof self !== 'undefined' ? self : global;
/*
 * Simple Symbol() shim
 */
var hasSymbol = typeof Symbol !== 'undefined';
function createSymbol (name) {
  return hasSymbol ? Symbol() : '@@' + name;
}





/*
 * Environment baseURI
 */
var baseURI;

// environent baseURI detection
if (typeof document != 'undefined' && document.getElementsByTagName) {
  baseURI = document.baseURI;

  if (!baseURI) {
    var bases = document.getElementsByTagName('base');
    baseURI = bases[0] && bases[0].href || window.location.href;
  }
}
else if (typeof location != 'undefined') {
  baseURI = location.href;
}

// sanitize out the hash and querystring
if (baseURI) {
  baseURI = baseURI.split('#')[0].split('?')[0];
  var slashIndex = baseURI.lastIndexOf('/');
  if (slashIndex !== -1)
    baseURI = baseURI.substr(0, slashIndex + 1);
}
else if (typeof process !== 'undefined' && process.cwd) {
  baseURI = 'file://' + (isWindows ? '/' : '') + process.cwd();
  if (isWindows)
    baseURI = baseURI.replace(/\\/g, '/');
}
else {
  throw new TypeError('No environment baseURI');
}

// ensure baseURI has trailing "/"
if (baseURI[baseURI.length - 1] !== '/')
  baseURI += '/';

/*
 * LoaderError with chaining for loader stacks
 */
var errArgs = new Error(0, '_').fileName == '_';
function LoaderError__Check_error_message_for_loader_stack (childErr, newMessage) {
  // Convert file:/// URLs to paths in Node
  if (!isBrowser)
    newMessage = newMessage.replace(isWindows ? /file:\/\/\//g : /file:\/\//g, '');

  var message = (childErr.message || childErr) + '\n  ' + newMessage;

  var err;
  if (errArgs && childErr.fileName)
    err = new Error(message, childErr.fileName, childErr.lineNumber);
  else
    err = new Error(message);


  var stack = childErr.originalErr ? childErr.originalErr.stack : childErr.stack;

  if (isNode)
    // node doesn't show the message otherwise
    err.stack = message + '\n  ' + stack;
  else
    err.stack = stack;

  err.originalErr = childErr.originalErr || childErr;

  return err;
}

/*
 * Optimized URL normalization assuming a syntax-valid URL parent
 */
function throwResolveError (relUrl, parentUrl) {
  throw new RangeError('Unable to resolve "' + relUrl + '" to ' + parentUrl);
}
function resolveIfNotPlain (relUrl, parentUrl) {
  relUrl = relUrl.trim();
  var parentProtocol = parentUrl && parentUrl.substr(0, parentUrl.indexOf(':') + 1);

  var firstChar = relUrl[0];
  var secondChar = relUrl[1];

  // protocol-relative
  if (firstChar === '/' && secondChar === '/') {
    if (!parentProtocol)
      throwResolveError(relUrl, parentUrl);
    return parentProtocol + relUrl;
  }
  // relative-url
  else if (firstChar === '.' && (secondChar === '/' || secondChar === '.' && (relUrl[2] === '/' || relUrl.length === 2) || relUrl.length === 1)
      || firstChar === '/') {
    var parentIsPlain = !parentProtocol || parentUrl[parentProtocol.length] !== '/';

    // read pathname from parent if a URL
    // pathname taken to be part after leading "/"
    var pathname;
    if (parentIsPlain) {
      // resolving to a plain parent -> skip standard URL prefix, and treat entire parent as pathname
      if (parentUrl === undefined)
        throwResolveError(relUrl, parentUrl);
      pathname = parentUrl;
    }
    else if (parentUrl[parentProtocol.length + 1] === '/') {
      // resolving to a :// so we need to read out the auth and host
      if (parentProtocol !== 'file:') {
        pathname = parentUrl.substr(parentProtocol.length + 2);
        pathname = pathname.substr(pathname.indexOf('/') + 1);
      }
      else {
        pathname = parentUrl.substr(8);
      }
    }
    else {
      // resolving to :/ so pathname is the /... part
      pathname = parentUrl.substr(parentProtocol.length + 1);
    }

    if (firstChar === '/') {
      if (parentIsPlain)
        throwResolveError(relUrl, parentUrl);
      else
        return parentUrl.substr(0, parentUrl.length - pathname.length - 1) + relUrl;
    }

    // join together and split for removal of .. and . segments
    // looping the string instead of anything fancy for perf reasons
    // '../../../../../z' resolved to 'x/y' is just 'z' regardless of parentIsPlain
    var segmented = pathname.substr(0, pathname.lastIndexOf('/') + 1) + relUrl;

    var output = [];
    var segmentIndex = undefined;

    for (var i = 0; i < segmented.length; i++) {
      // busy reading a segment - only terminate on '/'
      if (segmentIndex !== undefined) {
        if (segmented[i] === '/') {
          output.push(segmented.substr(segmentIndex, i - segmentIndex + 1));
          segmentIndex = undefined;
        }
        continue;
      }

      // new segment - check if it is relative
      if (segmented[i] === '.') {
        // ../ segment
        if (segmented[i + 1] === '.' && (segmented[i + 2] === '/' || i === segmented.length - 2)) {
          output.pop();
          i += 2;
        }
        // ./ segment
        else if (segmented[i + 1] === '/' || i === segmented.length - 1) {
          i += 1;
        }
        else {
          // the start of a new segment as below
          segmentIndex = i;
          continue;
        }

        // this is the plain URI backtracking error (../, package:x -> error)
        if (parentIsPlain && output.length === 0)
          throwResolveError(relUrl, parentUrl);

        // trailing . or .. segment
        if (i === segmented.length)
          output.push('');
        continue;
      }

      // it is the start of a new segment
      segmentIndex = i;
    }
    // finish reading out the last segment
    if (segmentIndex !== undefined)
      output.push(segmented.substr(segmentIndex, segmented.length - segmentIndex));

    return parentUrl.substr(0, parentUrl.length - pathname.length) + output.join('');
  }

  // sanitizes and verifies (by returning undefined if not a valid URL-like form)
  // Windows filepath compatibility is an added convenience here
  var protocolIndex = relUrl.indexOf(':');
  if (protocolIndex !== -1) {
    if (isNode) {
      // C:\x becomes file:///c:/x (we don't support C|\x)
      if (relUrl[1] === ':' && relUrl[2] === '\\' && relUrl[0].match(/[a-z]/i))
        return 'file:///' + relUrl.replace(/\\/g, '/');
    }
    return relUrl;
  }
}

var resolvedPromise$1 = Promise.resolve();

/*
 * Simple Array values shim
 */
function arrayValues (arr) {
  if (arr.values)
    return arr.values();

  if (typeof Symbol === 'undefined' || !Symbol.iterator)
    throw new Error('Symbol.iterator not supported in this browser');

  var iterable = {};
  iterable[Symbol.iterator] = function () {
    var keys = Object.keys(arr);
    var keyIndex = 0;
    return {
      next: function () {
        if (keyIndex < keys.length)
          return {
            value: arr[keys[keyIndex++]],
            done: false
          };
        else
          return {
            value: undefined,
            done: true
          };
      }
    };
  };
  return iterable;
}

/*
 * 3. Reflect.Loader
 *
 * We skip the entire native internal pipeline, just providing the bare API
 */
// 3.1.1
function Loader () {
  this.registry = new Registry();
}
// 3.3.1
Loader.prototype.constructor = Loader;

function ensureInstantiated (module) {
  if (!(module instanceof ModuleNamespace))
    throw new TypeError('Module instantiation did not return a valid namespace object.');
  return module;
}

// 3.3.2
Loader.prototype.import = function (key, parent) {
  if (typeof key !== 'string')
    throw new TypeError('Loader import method must be passed a module key string');
  // custom resolveInstantiate combined hook for better perf
  var loader = this;
  return resolvedPromise$1
  .then(function () {
    return loader[RESOLVE_INSTANTIATE](key, parent);
  })
  .then(ensureInstantiated)
  //.then(Module.evaluate)
  .catch(function (err) {
    throw LoaderError__Check_error_message_for_loader_stack(err, 'Loading ' + key + (parent ? ' from ' + parent : ''));
  });
};
// 3.3.3
var RESOLVE = Loader.resolve = createSymbol('resolve');

/*
 * Combined resolve / instantiate hook
 *
 * Not in current reduced spec, but necessary to separate RESOLVE from RESOLVE + INSTANTIATE as described
 * in the spec notes of this repo to ensure that loader.resolve doesn't instantiate when not wanted.
 *
 * We implement RESOLVE_INSTANTIATE as a single hook instead of a separate INSTANTIATE in order to avoid
 * the need for double registry lookups as a performance optimization.
 */
var RESOLVE_INSTANTIATE = Loader.resolveInstantiate = createSymbol('resolveInstantiate');

// default resolveInstantiate is just to call resolve and then get from the registry
// this provides compatibility for the resolveInstantiate optimization
Loader.prototype[RESOLVE_INSTANTIATE] = function (key, parent) {
  var loader = this;
  return loader.resolve(key, parent)
  .then(function (resolved) {
    return loader.registry.get(resolved);
  });
};

function ensureResolution (resolvedKey) {
  if (resolvedKey === undefined)
    throw new RangeError('No resolution found.');
  return resolvedKey;
}

Loader.prototype.resolve = function (key, parent) {
  var loader = this;
  return resolvedPromise$1
  .then(function() {
    return loader[RESOLVE](key, parent);
  })
  .then(ensureResolution)
  .catch(function (err) {
    throw LoaderError__Check_error_message_for_loader_stack(err, 'Resolving ' + key + (parent ? ' to ' + parent : ''));
  });
};

// 3.3.4 (import without evaluate)
// this is not documented because the use of deferred evaluation as in Module.evaluate is not
// documented, as it is not considered a stable feature to be encouraged
// Loader.prototype.load may well be deprecated if this stays disabled
/* Loader.prototype.load = function (key, parent) {
  return Promise.resolve(this[RESOLVE_INSTANTIATE](key, parent || this.key))
  .catch(function (err) {
    throw addToError(err, 'Loading ' + key + (parent ? ' from ' + parent : ''));
  });
}; */

/*
 * 4. Registry
 *
 * Instead of structuring through a Map, just use a dictionary object
 * We throw for construction attempts so this doesn't affect the public API
 *
 * Registry has been adjusted to use Namespace objects over ModuleStatus objects
 * as part of simplifying loader API implementation
 */
var iteratorSupport = typeof Symbol !== 'undefined' && Symbol.iterator;
var REGISTRY = createSymbol('registry');
function Registry() {
  this[REGISTRY] = {};
  this._registry = REGISTRY;
}
// 4.4.1
if (iteratorSupport) {
  // 4.4.2
  Registry.prototype[Symbol.iterator] = function () {
    return this.entries()[Symbol.iterator]();
  };

  // 4.4.3
  Registry.prototype.entries = function () {
    var registry = this[REGISTRY];
    return arrayValues(Object.keys(registry).map(function (key) {
      return [key, registry[key]];
    }));
  };
}

// 4.4.4
Registry.prototype.keys = function () {
  return arrayValues(Object.keys(this[REGISTRY]));
};
// 4.4.5
Registry.prototype.values = function () {
  var registry = this[REGISTRY];
  return arrayValues(Object.keys(registry).map(function (key) {
    return registry[key];
  }));
};
// 4.4.6
Registry.prototype.get = function (key) {
  return this[REGISTRY][key];
};
// 4.4.7
Registry.prototype.set = function (key, namespace) {
  if (!(namespace instanceof ModuleNamespace))
    throw new Error('Registry must be set with an instance of Module Namespace');
  this[REGISTRY][key] = namespace;
  return this;
};
// 4.4.8
Registry.prototype.has = function (key) {
  return Object.hasOwnProperty.call(this[REGISTRY], key);
};
// 4.4.9
Registry.prototype.delete = function (key) {
  if (Object.hasOwnProperty.call(this[REGISTRY], key)) {
    delete this[REGISTRY][key];
    return true;
  }
  return false;
};

/*
 * Simple ModuleNamespace Exotic object based on a baseObject
 * We export this for allowing a fast-path for module namespace creation over Module descriptors
 */
// var EVALUATE = createSymbol('evaluate');
var BASE_OBJECT = createSymbol('baseObject');

// 8.3.1 Reflect.Module
/*
 * Best-effort simplified non-spec implementation based on
 * a baseObject referenced via getters.
 *
 * Allows:
 *
 *   loader.registry.set('x', new Module({ default: 'x' }));
 *
 * Optional evaluation function provides experimental Module.evaluate
 * support for non-executed modules in registry.
 */
function ModuleNamespace (baseObject/*, evaluate*/) {
  Object.defineProperty(this, BASE_OBJECT, {
    value: baseObject
  });

  // evaluate defers namespace population
  /* if (evaluate) {
    Object.defineProperty(this, EVALUATE, {
      value: evaluate,
      configurable: true,
      writable: true
    });
  }
  else { */
    Object.keys(baseObject).forEach(extendNamespace, this);
  //}
}
// 8.4.2
ModuleNamespace.prototype = Object.create(null);

if (typeof Symbol !== 'undefined' && Symbol.toStringTag)
  Object.defineProperty(ModuleNamespace.prototype, Symbol.toStringTag, {
    value: 'Module'
  });

function extendNamespace (key) {
  Object.defineProperty(this, key, {
    enumerable: true,
    get: function () {
      return this[BASE_OBJECT][key];
    }
  });
}

/* function doEvaluate (evaluate, context) {
  try {
    evaluate.call(context);
  }
  catch (e) {
    return e;
  }
}

// 8.4.1 Module.evaluate... not documented or used because this is potentially unstable
Module.evaluate = function (ns) {
  var evaluate = ns[EVALUATE];
  if (evaluate) {
    ns[EVALUATE] = undefined;
    var err = doEvaluate(evaluate);
    if (err) {
      // cache the error
      ns[EVALUATE] = function () {
        throw err;
      };
      throw err;
    }
    Object.keys(ns[BASE_OBJECT]).forEach(extendNamespace, ns);
  }
  // make chainable
  return ns;
}; */

/*
 * Register Loader
 *
 * Builds directly on top of loader polyfill to provide:
 * - loader.register support
 * - hookable higher-level resolve
 * - instantiate hook returning a ModuleNamespace or undefined for es module loading
 * - loader error behaviour as in HTML and loader specs, clearing failed modules from registration cache synchronously
 * - build tracing support by providing a .trace=true and .loads object format
 */

var REGISTER_INTERNAL = createSymbol('register-internal');

function RegisterLoader$1 () {
  Loader.call(this);

  var registryDelete = this.registry.delete;
  this.registry.delete = function (key) {
    var deleted = registryDelete.call(this, key);

    // also delete from register registry if linked
    if (records.hasOwnProperty(key) && !records[key].linkRecord)
      delete records[key];

    return deleted;
  };

  var records = {};

  this[REGISTER_INTERNAL] = {
    // last anonymous System.register call
    lastRegister: undefined,
    // in-flight es module load records
    records: records
  };

  // tracing
  this.trace = false;
}

RegisterLoader$1.prototype = Object.create(Loader.prototype);
RegisterLoader$1.prototype.constructor = RegisterLoader$1;

var INSTANTIATE = RegisterLoader$1.instantiate = createSymbol('instantiate');

// default normalize is the WhatWG style normalizer
RegisterLoader$1.prototype[RegisterLoader$1.resolve = Loader.resolve] = function (key, parentKey) {
  return resolveIfNotPlain(key, parentKey || baseURI);
};

RegisterLoader$1.prototype[INSTANTIATE] = function (key, processAnonRegister) {};

// once evaluated, the linkRecord is set to undefined leaving just the other load record properties
// this allows tracking new binding listeners for es modules through importerSetters
// for dynamic modules, the load record is removed entirely.
function createLoadRecord (state, key, registration) {
  return state.records[key] = {
    key: key,

    // defined System.register cache
    registration: registration,

    // module namespace object
    module: undefined,

    // es-only
    // this sticks around so new module loads can listen to binding changes
    // for already-loaded modules by adding themselves to their importerSetters
    importerSetters: undefined,

    // in-flight linking record
    linkRecord: {
      // promise for instantiated
      instantiatePromise: undefined,
      dependencies: undefined,
      execute: undefined,
      executingRequire: false,

      // underlying module object bindings
      moduleObj: undefined,

      // es only, also indicates if es or not
      setters: undefined,

      // promise for instantiated dependencies (dependencyInstantiations populated)
      depsInstantiatePromise: undefined,
      // will be the array of dependency load record or a module namespace
      dependencyInstantiations: undefined,

      // indicates if the load and all its dependencies are instantiated and linked
      // but not yet executed
      // mostly just a performance shortpath to avoid rechecking the promises above
      linked: false,

      error: undefined
      // NB optimization and way of ensuring module objects in setters
      // indicates setters which should run pre-execution of that dependency
      // setters is then just for completely executed module objects
      // alternatively we just pass the partially filled module objects as
      // arguments into the execute function
      // hoisted: undefined
    }
  };
}

RegisterLoader$1.prototype[Loader.resolveInstantiate] = function (key, parentKey) {
  var loader = this;
  var state = this[REGISTER_INTERNAL];
  var registry = loader.registry[loader.registry._registry];

  return resolveInstantiate(loader, key, parentKey, registry, state)
  .then(function (instantiated) {
    if (instantiated instanceof ModuleNamespace)
      return instantiated;

    // if already beaten to linked, return
    if (instantiated.module)
      return instantiated.module;

    // resolveInstantiate always returns a load record with a link record and no module value
    if (instantiated.linkRecord.linked)
      return ensureEvaluate(loader, instantiated, instantiated.linkRecord, registry, state, undefined);

    return instantiateDeps(loader, instantiated, instantiated.linkRecord, registry, state, [instantiated])
    .then(function () {
      return ensureEvaluate(loader, instantiated, instantiated.linkRecord, registry, state, undefined);
    })
    .catch(function (err) {
      clearLoadErrors(loader, instantiated);
      throw err;
    });
  });
};

function resolveInstantiate (loader, key, parentKey, registry, state) {
  // normalization shortpath for already-normalized key
  // could add a plain name filter, but doesn't yet seem necessary for perf
  var module = registry[key];
  if (module)
    return Promise.resolve(module);

  var load = state.records[key];

  // already linked but not in main registry is ignored
  if (load && !load.module)
    return instantiate(loader, load, load.linkRecord, registry, state);

  return loader.resolve(key, parentKey)
  .then(function (resolvedKey) {
    // main loader registry always takes preference
    module = registry[resolvedKey];
    if (module)
      return module;

    load = state.records[resolvedKey];

    // already has a module value but not already in the registry (load.module)
    // means it was removed by registry.delete, so we should
    // disgard the current load record creating a new one over it
    // but keep any existing registration
    if (!load || load.module)
      load = createLoadRecord(state, resolvedKey, load && load.registration);

    var link = load.linkRecord;
    if (!link)
      return load;

    return instantiate(loader, load, link, registry, state);
  });
}

function createProcessAnonRegister (loader, load, state) {
  return function () {
    var lastRegister = state.lastRegister;

    if (!lastRegister)
      return !!load.registration;

    state.lastRegister = undefined;
    load.registration = lastRegister;

    return true;
  };
}

function instantiate (loader, load, link, registry, state) {
  return link.instantiatePromise || (link.instantiatePromise =
  // if there is already an existing registration, skip running instantiate
  (load.registration ? Promise.resolve() : Promise.resolve().then(function () {
    state.lastRegister = undefined;
    return loader[INSTANTIATE](load.key, loader[INSTANTIATE].length > 1 && createProcessAnonRegister(loader, load, state));
  }))
  .then(function (instantiation) {
    // direct module return from instantiate -> we're done
    if (instantiation !== undefined) {
      if (!(instantiation instanceof ModuleNamespace))
        throw new TypeError('Instantiate did not return a valid Module object.');

      delete state.records[load.key];
      if (loader.trace)
        traceLoad(loader, load, link);
      return registry[load.key] = instantiation;
    }

    // run the cached loader.register declaration if there is one
    var registration = load.registration;
    // clear to allow new registrations for future loads (combined with registry delete)
    load.registration = undefined;
    if (!registration)
      throw new TypeError('Module instantiation did not call an anonymous or correctly named System.register.');

    link.dependencies = registration[0];

    load.importerSetters = [];

    link.moduleObj = {};

    // process System.registerDynamic declaration
    if (registration[2]) {
      link.moduleObj.default = {};
      link.moduleObj.__useDefault = true;
      link.executingRequire = registration[1];
      link.execute = registration[2];
    }

    // process System.register declaration
    else {
      registerDeclarative(loader, load, link, registration[1]);
    }

    // shortpath to instantiateDeps
    if (!link.dependencies.length) {
      link.linked = true;
      if (loader.trace)
        traceLoad(loader, load, link);
    }

    return load;
  })
  .catch(function (err) {
    throw link.error = LoaderError__Check_error_message_for_loader_stack(err, 'Instantiating ' + load.key);
  }));
}

// like resolveInstantiate, but returning load records for linking
function resolveInstantiateDep (loader, key, parentKey, registry, state, traceDepMap) {
  // normalization shortpaths for already-normalized key
  // DISABLED to prioritise consistent resolver calls
  // could add a plain name filter, but doesn't yet seem necessary for perf
  /* var load = state.records[key];
  var module = registry[key];

  if (module) {
    if (traceDepMap)
      traceDepMap[key] = key;

    // registry authority check in case module was deleted or replaced in main registry
    if (load && load.module && load.module === module)
      return load;
    else
      return module;
  }

  // already linked but not in main registry is ignored
  if (load && !load.module) {
    if (traceDepMap)
      traceDepMap[key] = key;
    return instantiate(loader, load, load.linkRecord, registry, state);
  } */
  return loader.resolve(key, parentKey)
  .then(function (resolvedKey) {
    if (traceDepMap)
      traceDepMap[key] = resolvedKey;

    // normalization shortpaths for already-normalized key
    var load = state.records[resolvedKey];
    var module = registry[resolvedKey];

    // main loader registry always takes preference
    if (module && (!load || load.module && module !== load.module))
      return module;

    // already has a module value but not already in the registry (load.module)
    // means it was removed by registry.delete, so we should
    // disgard the current load record creating a new one over it
    // but keep any existing registration
    if (!load || !module && load.module)
      load = createLoadRecord(state, resolvedKey, load && load.registration);

    var link = load.linkRecord;
    if (!link)
      return load;

    return instantiate(loader, load, link, registry, state);
  });
}

function traceLoad (loader, load, link) {
  loader.loads = loader.loads || {};
  loader.loads[load.key] = {
    key: load.key,
    deps: link.dependencies,
    dynamicDeps: [],
    depMap: link.depMap || {}
  };
}

function traceDynamicLoad (loader, parentKey, key) {
  loader.loads[parentKey].dynamicDeps.push(key);
}

/*
 * Convert a CJS module.exports into a valid object for new Module:
 *
 *   new Module(getEsModule(module.exports))
 *
 * Sets the default value to the module, while also reading off named exports carefully.
 */
function registerDeclarative (loader, load, link, declare) {
  var moduleObj = link.moduleObj;
  var importerSetters = load.importerSetters;

  var definedExports = false;

  // closure especially not based on link to allow link record disposal
  var declared = declare.call(envGlobal, function (name, value) {
    if (typeof name === 'object') {
      var changed = false;
      for (var p in name) {
        value = name[p];
        if (p !== '__useDefault' && (!(p in moduleObj) || moduleObj[p] !== value)) {
          changed = true;
          moduleObj[p] = value;
        }
      }
      if (changed === false)
        return value;
    }
    else {
      if ((definedExports || name in moduleObj) && moduleObj[name] === value)
        return value;
      moduleObj[name] = value;
    }

    for (var i = 0; i < importerSetters.length; i++)
      importerSetters[i](moduleObj);

    return value;
  }, new ContextualLoader(loader, load.key));

  link.setters = declared.setters;
  link.execute = declared.execute;
  if (declared.exports) {
    link.moduleObj = moduleObj = declared.exports;
    definedExports = true;
  }
}

function instantiateDeps (loader, load, link, registry, state, seen) {
  return (link.depsInstantiatePromise || (link.depsInstantiatePromise = Promise.resolve()
  .then(function () {
    var depsInstantiatePromises = Array(link.dependencies.length);

    for (var i = 0; i < link.dependencies.length; i++)
      depsInstantiatePromises[i] = resolveInstantiateDep(loader, link.dependencies[i], load.key, registry, state, loader.trace && link.depMap || (link.depMap = {}));

    return Promise.all(depsInstantiatePromises);
  })
  .then(function (dependencyInstantiations) {
    link.dependencyInstantiations = dependencyInstantiations;

    // run setters to set up bindings to instantiated dependencies
    if (link.setters) {
      for (var i = 0; i < dependencyInstantiations.length; i++) {
        var setter = link.setters[i];
        if (setter) {
          var instantiation = dependencyInstantiations[i];

          if (instantiation instanceof ModuleNamespace) {
            setter(instantiation);
          }
          else {
            setter(instantiation.module || instantiation.linkRecord.moduleObj);
            // this applies to both es and dynamic registrations
            if (instantiation.importerSetters)
              instantiation.importerSetters.push(setter);
          }
        }
      }
    }
  })))
  .then(function () {
    // now deeply instantiateDeps on each dependencyInstantiation that is a load record
    var deepDepsInstantiatePromises = [];

    for (var i = 0; i < link.dependencies.length; i++) {
      var depLoad = link.dependencyInstantiations[i];
      var depLink = depLoad.linkRecord;

      if (!depLink || depLink.linked)
        continue;

      if (seen.indexOf(depLoad) !== -1) {
        deepDepsInstantiatePromises.push(depLink.depsInstantiatePromise);
        continue;
      }
      seen.push(depLoad);

      deepDepsInstantiatePromises.push(instantiateDeps(loader, depLoad, depLoad.linkRecord, registry, state, seen));
    }

    return Promise.all(deepDepsInstantiatePromises);
  })
  .then(function () {
    // as soon as all dependencies instantiated, we are ready for evaluation so can add to the registry
    // this can run multiple times, but so what
    link.linked = true;
    if (loader.trace)
      traceLoad(loader, load, link);

    return load;
  })
  .catch(function (err) {
    err = LoaderError__Check_error_message_for_loader_stack(err, 'Loading ' + load.key);

    // throw up the instantiateDeps stack
    // loads are then synchonously cleared at the top-level through the clearLoadErrors helper below
    // this then ensures avoiding partially unloaded tree states
    link.error = link.error || err;

    throw err;
  });
}

// clears an errored load and all its errored dependencies from the loads registry
function clearLoadErrors (loader, load) {
  var state = loader[REGISTER_INTERNAL];

  // clear from loads
  if (state.records[load.key] === load)
    delete state.records[load.key];

  var link = load.linkRecord;

  if (!link)
    return;

  if (link.dependencyInstantiations)
    link.dependencyInstantiations.forEach(function (depLoad, index) {
      if (!depLoad || depLoad instanceof ModuleNamespace)
        return;

      if (depLoad.linkRecord) {
        if (depLoad.linkRecord.error) {
          // provides a circular reference check
          if (state.records[depLoad.key] === depLoad)
            clearLoadErrors(loader, depLoad);
        }

        // unregister setters for es dependency load records that will remain
        if (link.setters && depLoad.importerSetters) {
          var setterIndex = depLoad.importerSetters.indexOf(link.setters[index]);
          depLoad.importerSetters.splice(setterIndex, 1);
        }
      }
    });
}

/*
 * System.register
 */
RegisterLoader$1.prototype.register = function (key, deps, declare) {
  var state = this[REGISTER_INTERNAL];

  // anonymous modules get stored as lastAnon
  if (declare === undefined) {
    state.lastRegister = [key, deps, undefined];
  }

  // everything else registers into the register cache
  else {
    var load = state.records[key] || createLoadRecord(state, key, undefined);
    load.registration = [deps, declare, undefined];
  }
};

/*
 * System.registerDyanmic
 */
RegisterLoader$1.prototype.registerDynamic = function (key, deps, executingRequire, execute) {
  var state = this[REGISTER_INTERNAL];

  // anonymous modules get stored as lastAnon
  if (typeof key !== 'string') {
    state.lastRegister = [key, deps, executingRequire];
  }

  // everything else registers into the register cache
  else {
    var load = state.records[key] || createLoadRecord(state, key, undefined);
    load.registration = [deps, executingRequire, execute];
  }
};

// ContextualLoader class
// backwards-compatible with previous System.register context argument by exposing .id
function ContextualLoader (loader, key) {
  this.loader = loader;
  this.key = this.id = key;
}
/*ContextualLoader.prototype.constructor = function () {
  throw new TypeError('Cannot subclass the contextual loader only Reflect.Loader.');
};*/
ContextualLoader.prototype.import = function (key) {
  if (this.loader.trace)
    traceDynamicLoad(this.loader, this.key, key);
  return this.loader.import(key, this.key);
};
/*ContextualLoader.prototype.resolve = function (key) {
  return this.loader.resolve(key, this.key);
};*/

// this is the execution function bound to the Module namespace record
function ensureEvaluate (loader, load, link, registry, state, seen) {
  if (load.module)
    return load.module;

  if (link.error)
    throw link.error;

  if (seen && seen.indexOf(load) !== -1)
    return load.linkRecord.moduleObj;

  // for ES loads we always run ensureEvaluate on top-level, so empty seen is passed regardless
  // for dynamic loads, we pass seen if also dynamic
  var err = doEvaluate(loader, load, link, registry, state, link.setters ? [] : seen || []);
  if (err) {
    clearLoadErrors(loader, load);
    throw err;
  }

  return load.module;
}

function makeDynamicRequire (loader, key, dependencies, dependencyInstantiations, registry, state, seen) {
  // we can only require from already-known dependencies
  return function (name) {
    for (var i = 0; i < dependencies.length; i++) {
      if (dependencies[i] === name) {
        var depLoad = dependencyInstantiations[i];
        var module;

        if (depLoad instanceof ModuleNamespace)
          module = depLoad;
        else
          module = ensureEvaluate(loader, depLoad, depLoad.linkRecord, registry, state, seen);

        return module.__useDefault ? module.default : module;
      }
    }
    throw new Error('Module ' + name + ' not declared as a System.registerDynamic dependency of ' + key);
  };
}

// ensures the given es load is evaluated
// returns the error if any
function doEvaluate (loader, load, link, registry, state, seen) {
  seen.push(load);

  var err;

  // es modules evaluate dependencies first
  // non es modules explicitly call moduleEvaluate through require
  if (link.setters) {
    var depLoad, depLink;
    for (var i = 0; i < link.dependencies.length; i++) {
      depLoad = link.dependencyInstantiations[i];

      if (depLoad instanceof ModuleNamespace)
        continue;

      // custom Module returned from instantiate
      depLink = depLoad.linkRecord;
      if (depLink && seen.indexOf(depLoad) === -1) {
        if (depLink.error)
          err = depLink.error;
        else
          // dynamic / declarative boundaries clear the "seen" list
          // we just let cross format circular throw as would happen in real implementations
          err = doEvaluate(loader, depLoad, depLink, registry, state, depLink.setters ? seen : []);
      }

      if (err)
        return link.error = LoaderError__Check_error_message_for_loader_stack(err, 'Evaluating ' + load.key);
    }
  }

  // link.execute won't exist for Module returns from instantiate on top-level load
  if (link.execute) {
    // ES System.register execute
    // "this" is null in ES
    if (link.setters) {
      err = declarativeExecute(link.execute);
    }
    // System.registerDynamic execute
    // "this" is "exports" in CJS
    else {
      var module = { id: load.key };
      var moduleObj = link.moduleObj;
      Object.defineProperty(module, 'exports', {
        configurable: true,
        set: function (exports) {
          moduleObj.default = exports;
        },
        get: function () {
          return moduleObj.default;
        }
      });

      var require = makeDynamicRequire(loader, load.key, link.dependencies, link.dependencyInstantiations, registry, state, seen);

      // evaluate deps first
      if (!link.executingRequire)
        for (var i = 0; i < link.dependencies.length; i++)
          require(link.dependencies[i]);

      err = dynamicExecute(link.execute, require, moduleObj.default, module);

      // pick up defineProperty calls to module.exports when we can
      if (module.exports !== moduleObj.default)
        moduleObj.default = module.exports;

      var moduleDefault = moduleObj.default;

      // __esModule flag extension support via lifting
      if (moduleDefault && moduleDefault.__esModule) {
        for (var p in moduleObj.default) {
          if (Object.hasOwnProperty.call(moduleObj.default, p) && p !== 'default')
            moduleObj[p] = moduleDefault[p];
        }
      }
    }
  }

  if (err)
    return link.error = LoaderError__Check_error_message_for_loader_stack(err, 'Evaluating ' + load.key);

  registry[load.key] = load.module = new ModuleNamespace(link.moduleObj);

  // if not an esm module, run importer setters and clear them
  // this allows dynamic modules to update themselves into es modules
  // as soon as execution has completed
  if (!link.setters) {
    if (load.importerSetters)
      for (var i = 0; i < load.importerSetters.length; i++)
        load.importerSetters[i](load.module);
    load.importerSetters = undefined;
  }

  // dispose link record
  load.linkRecord = undefined;
}

// {} is the closest we can get to call(undefined)
var nullContext = {};
if (Object.freeze)
  Object.freeze(nullContext);

function declarativeExecute (execute) {
  try {
    execute.call(nullContext);
  }
  catch (e) {
    return e;
  }
}

function dynamicExecute (execute, require, exports, module) {
  try {
    var output = execute.call(envGlobal, require, exports, module);
    if (output !== undefined)
      module.exports = output;
  }
  catch (e) {
    return e;
  }
}

var resolvedPromise = Promise.resolve();
function noop () {}

var emptyModule = new ModuleNamespace({});

function protectedCreateNamespace (bindings) {
  if (bindings instanceof ModuleNamespace)
    return bindings;

  if (bindings && bindings.__esModule)
    return new ModuleNamespace(bindings);

  return new ModuleNamespace({ default: bindings, __useDefault: true });
}

var hasStringTag;
function isModule (m) {
  if (hasStringTag === undefined)
    hasStringTag = typeof Symbol !== 'undefined' && !!Symbol.toStringTag;
  return m instanceof ModuleNamespace || hasStringTag && Object.prototype.toString.call(m) == '[object Module]';
}

var CONFIG = createSymbol('loader-config');
var METADATA = createSymbol('metadata');



var isWorker = typeof window === 'undefined' && typeof self !== 'undefined' && typeof importScripts !== 'undefined';

function warn (msg, force) {
  if (force || this.warnings && typeof console !== 'undefined' && console.warn)
    console.warn(msg);
}

function checkInstantiateWasm (loader, wasmBuffer, processAnonRegister) {
  var bytes = new Uint8Array(wasmBuffer);

  // detect by leading bytes
  // Can be (new Uint32Array(fetched))[0] === 0x6D736100 when working in Node
  if (bytes[0] === 0 && bytes[1] === 97 && bytes[2] === 115) {
    return WebAssembly.compile(wasmBuffer).then(function (m) {
      var deps = [];
      var setters = [];
      var importObj = {};

      // we can only set imports if supported (eg Safari doesnt support)
      if (WebAssembly.Module.imports)
        WebAssembly.Module.imports(m).forEach(function (i) {
          var key = i.module;
          setters.push(function (m) {
            importObj[key] = m;
          });
          if (deps.indexOf(key) === -1)
            deps.push(key);
        });
      loader.register(deps, function (_export) {
        return {
          setters: setters,
          execute: function () {
            _export(new WebAssembly.Instance(m, importObj).exports);
          }
        };
      });
      processAnonRegister();

      return true;
    });
  }

  return Promise.resolve(false);
}

var parentModuleContext;
function loadNodeModule (key, baseURL) {
  if (key[0] === '.')
    throw new Error('Node module ' + key + ' can\'t be loaded as it is not a package require.');

  if (!parentModuleContext) {
    var Module = this._nodeRequire('module');
    var base = baseURL.substr(isWindows ? 8 : 7);
    parentModuleContext = new Module(base);
    parentModuleContext.paths = Module._nodeModulePaths(base);
  }
  return parentModuleContext.require(key);
}

function extend (a, b) {
  for (var p in b) {
    if (!Object.hasOwnProperty.call(b, p))
      continue;
    a[p] = b[p];
  }
  return a;
}

function prepend (a, b) {
  for (var p in b) {
    if (!Object.hasOwnProperty.call(b, p))
      continue;
    if (a[p] === undefined)
      a[p] = b[p];
  }
  return a;
}

// meta first-level extends where:
// array + array appends
// object + object extends
// other properties replace
function extendMeta (a, b, _prepend) {
  for (var p in b) {
    if (!Object.hasOwnProperty.call(b, p))
      continue;
    var val = b[p];
    if (a[p] === undefined)
      a[p] = val;
    else if (val instanceof Array && a[p] instanceof Array)
      a[p] = [].concat(_prepend ? val : a[p]).concat(_prepend ? a[p] : val);
    else if (typeof val == 'object' && val !== null && typeof a[p] == 'object')
      a[p] = (_prepend ? prepend : extend)(extend({}, a[p]), val);
    else if (!_prepend)
      a[p] = val;
  }
}

var supportsPreload = false;
var supportsPrefetch = false;
if (isBrowser)
  (function () {
    var relList = document.createElement('link').relList;
    if (relList && relList.supports) {
      supportsPrefetch = true;
      try {
        supportsPreload = relList.supports('preload');
      }
      catch (e) {}
    }
  })();

function preloadScript (url) {
  // fallback to old fashioned image technique which still works in safari
  if (!supportsPreload && !supportsPrefetch) {
    var preloadImage = new Image();
    preloadImage.src = url;
    return;
  }

  var link = document.createElement('link');
  if (supportsPreload) {
    link.rel = 'preload';
    link.as = 'script';
  }
  else {
    // this works for all except Safari (detected by relList.supports lacking)
    link.rel = 'prefetch';
  }
  link.href = url;
  document.head.appendChild(link);
  document.head.removeChild(link);
}

function workerImport (src, resolve, reject) {
  try {
    importScripts(src);
  }
  catch (e) {
    reject(e);
  }
  resolve();
}

if (isBrowser) {
  var loadingScripts = [];
  var onerror = window.onerror;
  window.onerror = function globalOnerror (msg, src) {
    for (var i = 0; i < loadingScripts.length; i++) {
      if (loadingScripts[i].src !== src)
        continue;
      loadingScripts[i].err(msg);
      return;
    }
    if (onerror)
      onerror.apply(this, arguments);
  };
}

function scriptLoad (src, crossOrigin, integrity, resolve, reject) {
  // percent encode just "#" for HTTP requests
  src = src.replace(/#/g, '%23');

  // subresource integrity is not supported in web workers
  if (isWorker)
    return workerImport(src, resolve, reject);

  var script = document.createElement('script');
  script.type = 'text/javascript';
  script.charset = 'utf-8';
  script.async = true;

  if (crossOrigin)
    script.crossOrigin = crossOrigin;
  if (integrity)
    script.integrity = integrity;

  script.addEventListener('load', load, false);
  script.addEventListener('error', error, false);

  script.src = src;
  document.head.appendChild(script);

  function load () {
    resolve();
    cleanup();
  }

  // note this does not catch execution errors
  function error (err) {
    cleanup();
    reject(new Error('Fetching ' + src));
  }

  function cleanup () {
    for (var i = 0; i < loadingScripts.length; i++) {
      if (loadingScripts[i].err === error) {
        loadingScripts.splice(i, 1);
        break;
      }
    }
    script.removeEventListener('load', load, false);
    script.removeEventListener('error', error, false);
    document.head.removeChild(script);
  }
}

function readMemberExpression (p, value) {
  var pParts = p.split('.');
  while (pParts.length)
    value = value[pParts.shift()];
  return value;
}

// separate out paths cache as a baseURL lock process
function applyPaths (baseURL, paths, key) {
  var mapMatch = getMapMatch(paths, key);
  if (mapMatch) {
    var target = paths[mapMatch] + key.substr(mapMatch.length);

    var resolved = resolveIfNotPlain(target, baseURI);
    if (resolved !== undefined)
      return resolved;

    return baseURL + target;
  }
  else if (key.indexOf(':') !== -1) {
    return key;
  }
  else {
    return baseURL + key;
  }
}

function checkMap (p) {
  var name = this.name;
  // can add ':' here if we want paths to match the behaviour of map
  if (name.substr(0, p.length) === p && (name.length === p.length || name[p.length] === '/' || p[p.length - 1] === '/' || p[p.length - 1] === ':')) {
    var curLen = p.split('/').length;
    if (curLen > this.len) {
      this.match = p;
      this.len = curLen;
    }
  }
}

function getMapMatch (map, name) {
  if (Object.hasOwnProperty.call(map, name))
    return name;

  var bestMatch = {
    name: name,
    match: undefined,
    len: 0
  };

  Object.keys(map).forEach(checkMap, bestMatch);

  return bestMatch.match;
}

// RegEx adjusted from https://github.com/jbrantly/yabble/blob/master/lib/yabble.js#L339
var cjsRequireRegEx = /(?:^\uFEFF?|[^$_a-zA-Z\xA0-\uFFFF."'])require\s*\(\s*("[^"\\]*(?:\\.[^"\\]*)*"|'[^'\\]*(?:\\.[^'\\]*)*')\s*\)/g;

/*
 * Source loading
 */
function fetchFetch (url, authorization, integrity, asBuffer) {
  // fetch doesn't support file:/// urls
  if (url.substr(0, 8) === 'file:///') {
    if (hasXhr)
      return xhrFetch(url, authorization, integrity, asBuffer);
    else
      throw new Error('Unable to fetch file URLs in this environment.');
  }

  // percent encode just "#" for HTTP requests
  url = url.replace(/#/g, '%23');

  var opts = {
    // NB deprecate
    headers: { Accept: 'application/x-es-module, */*' }
  };

  if (integrity)
    opts.integrity = integrity;

  if (authorization) {
    if (typeof authorization == 'string')
      opts.headers['Authorization'] = authorization;
    opts.credentials = 'include';
  }

  return fetch(url, opts)
  .then(function(res) {
    if (res.ok)
      return asBuffer ? res.arrayBuffer() : res.text();
    else
      throw new Error('Fetch error: ' + res.status + ' ' + res.statusText);
  });
}

function xhrFetch (url, authorization, integrity, asBuffer) {
  return new Promise(function (resolve, reject) {
    // percent encode just "#" for HTTP requests
    url = url.replace(/#/g, '%23');

    var xhr = new XMLHttpRequest();
    if (asBuffer)
      xhr.responseType = 'arraybuffer';
    function load() {
      resolve(asBuffer ? xhr.response : xhr.responseText);
    }
    function error() {
      reject(new Error('XHR error: ' + (xhr.status ? ' (' + xhr.status + (xhr.statusText ? ' ' + xhr.statusText  : '') + ')' : '') + ' loading ' + url));
    }

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        // in Chrome on file:/// URLs, status is 0
        if (xhr.status == 0) {
          if (xhr.response) {
            load();
          }
          else {
            // when responseText is empty, wait for load or error event
            // to inform if it is a 404 or empty file
            xhr.addEventListener('error', error);
            xhr.addEventListener('load', load);
          }
        }
        else if (xhr.status === 200) {
          load();
        }
        else {
          error();
        }
      }
    };
    xhr.open("GET", url, true);

    if (xhr.setRequestHeader) {
      xhr.setRequestHeader('Accept', 'application/x-es-module, */*');
      // can set "authorization: true" to enable withCredentials only
      if (authorization) {
        if (typeof authorization == 'string')
          xhr.setRequestHeader('Authorization', authorization);
        xhr.withCredentials = true;
      }
    }

    xhr.send(null);
  });
}

var fs;
function nodeFetch (url, authorization, integrity, asBuffer) {
  if (url.substr(0, 8) != 'file:///')
    return Promise.reject(new Error('Unable to fetch "' + url + '". Only file URLs of the form file:/// supported running in Node.'));

  fs = fs || require('fs');
  if (isWindows)
    url = url.replace(/\//g, '\\').substr(8);
  else
    url = url.substr(7);

  return new Promise(function (resolve, reject) {
    fs.readFile(url, function(err, data) {
      if (err) {
        return reject(err);
      }
      else {
        if (asBuffer) {
          resolve(data);
        }
        else {
          // Strip Byte Order Mark out if it's the leading char
          var dataString = data + '';
          if (dataString[0] === '\ufeff')
            dataString = dataString.substr(1);

          resolve(dataString);
        }
      }
    });
  });
}

function noFetch () {
  throw new Error('No fetch method is defined for this environment.');
}

var fetchFunction;

var hasXhr = typeof XMLHttpRequest !== 'undefined';

if (typeof self !== 'undefined' && typeof self.fetch !== 'undefined')
 fetchFunction = fetchFetch;
else if (hasXhr)
  fetchFunction = xhrFetch;
else if (typeof require !== 'undefined' && typeof process !== 'undefined')
  fetchFunction = nodeFetch;
else
  fetchFunction = noFetch;

var fetch$1 = fetchFunction;

function createMetadata () {
  return {
    pluginKey: undefined,
    pluginArgument: undefined,
    pluginModule: undefined,
    packageKey: undefined,
    packageConfig: undefined,
    load: undefined
  };
}

function getParentMetadata (loader, config, parentKey) {
  var parentMetadata = createMetadata();

  if (parentKey) {
    // detect parent plugin
    // we just need pluginKey to be truthy for package configurations
    // so we duplicate it as pluginArgument - although not correct its not used
    var parentPluginIndex;
    if (config.pluginFirst) {
      if ((parentPluginIndex = parentKey.lastIndexOf('!')) !== -1)
        parentMetadata.pluginArgument = parentMetadata.pluginKey = parentKey.substr(0, parentPluginIndex);
    }
    else {
      if ((parentPluginIndex = parentKey.indexOf('!')) !== -1)
        parentMetadata.pluginArgument = parentMetadata.pluginKey = parentKey.substr(parentPluginIndex + 1);
    }

    // detect parent package
    parentMetadata.packageKey = getMapMatch(config.packages, parentKey);
    if (parentMetadata.packageKey)
      parentMetadata.packageConfig = config.packages[parentMetadata.packageKey];
  }

  return parentMetadata;
}

function normalize (key, parentKey) {
  var config = this[CONFIG];

  var metadata = createMetadata();
  var parentMetadata = getParentMetadata(this, config, parentKey);

  var loader = this;

  return Promise.resolve()

  // boolean conditional
  .then(function () {
    // first we normalize the conditional
    var booleanIndex = key.lastIndexOf('#?');

    if (booleanIndex === -1)
      return Promise.resolve(key);

    var conditionObj = parseCondition.call(loader, key.substr(booleanIndex + 2));

    // in builds, return normalized conditional
    /*if (this.builder)
      return this.resolve(conditionObj.module, parentKey)
      .then(function (conditionModule) {
        conditionObj.module = conditionModule;
        return key.substr(0, booleanIndex) + '#?' + serializeCondition(conditionObj);
      });*/

    return resolveCondition.call(loader, conditionObj, parentKey, true)
    .then(function (conditionValue) {
      return conditionValue ? key.substr(0, booleanIndex) : '@empty';
    });
  })

  // plugin
  .then(function (key) {
    var parsed = parsePlugin(config.pluginFirst, key);

    if (!parsed)
      return packageResolve.call(loader, config, key, parentMetadata && parentMetadata.pluginArgument || parentKey, metadata, parentMetadata, false);

    metadata.pluginKey = parsed.plugin;

    return Promise.all([
      packageResolve.call(loader, config, parsed.argument, parentMetadata && parentMetadata.pluginArgument || parentKey, metadata, parentMetadata, true),
      loader.resolve(parsed.plugin, parentKey)
    ])
    .then(function (normalized) {
      metadata.pluginArgument = normalized[0];
      metadata.pluginKey = normalized[1];

      // don't allow a plugin to load itself
      if (metadata.pluginArgument === metadata.pluginKey)
        throw new Error('Plugin ' + metadata.pluginArgument + ' cannot load itself, make sure it is excluded from any wildcard meta configuration via a custom loader: false rule.');

      return combinePluginParts(config.pluginFirst, normalized[0], normalized[1]);
    });
  })
  .then(function (normalized) {
    return interpolateConditional.call(loader, normalized, parentKey, parentMetadata);
  })
  .then(function (normalized) {
    setMeta.call(loader, config, normalized, metadata);

    if (metadata.pluginKey || !metadata.load.loader)
      return normalized;

    // loader by configuration
    // normalizes to parent to support package loaders
    return loader.resolve(metadata.load.loader, normalized)
    .then(function (pluginKey) {
      metadata.pluginKey = pluginKey;
      metadata.pluginArgument = normalized;
      return normalized;
    });
  })
  .then(function (normalized) {
    loader[METADATA][normalized] = metadata;
    return normalized;
  });
}

// normalization function used for registry keys
// just does coreResolve without map
function decanonicalize (config, key) {
  var parsed = parsePlugin(config.pluginFirst, key);

  // plugin
  if (parsed) {
    var pluginKey = decanonicalize.call(this, config, parsed.plugin);
    return combinePluginParts(config.pluginFirst, coreResolve.call(this, config, parsed.argument, undefined, false, false), pluginKey);
  }

  return coreResolve.call(this, config, key, undefined, false, false);
}

function normalizeSync (key, parentKey) {
  var config = this[CONFIG];

  // normalizeSync is metadataless, so create metadata
  var metadata = createMetadata();
  var parentMetadata = parentMetadata || getParentMetadata(this, config, parentKey);

  var parsed = parsePlugin(config.pluginFirst, key);

  // plugin
  if (parsed) {
    metadata.pluginKey = normalizeSync.call(this, parsed.plugin, parentKey);
    return combinePluginParts(config.pluginFirst,
        packageResolveSync.call(this, config, parsed.argument, parentMetadata.pluginArgument || parentKey, metadata, parentMetadata, !!metadata.pluginKey),
        metadata.pluginKey);
  }

  return packageResolveSync.call(this, config, key, parentMetadata.pluginArgument || parentKey, metadata, parentMetadata, !!metadata.pluginKey);
}

function coreResolve (config, key, parentKey, doMap, packageName) {
  var relativeResolved = resolveIfNotPlain(key, parentKey || baseURI);

  // standard URL resolution
  if (relativeResolved)
    return applyPaths(config.baseURL, config.paths, relativeResolved);

  // plain keys not starting with './', 'x://' and '/' go through custom resolution
  if (doMap) {
    var mapMatch = getMapMatch(config.map, key);

    if (mapMatch) {
      key = config.map[mapMatch] + key.substr(mapMatch.length);

      relativeResolved = resolveIfNotPlain(key, baseURI);
      if (relativeResolved)
        return applyPaths(config.baseURL, config.paths, relativeResolved);
    }
  }

  if (this.registry.has(key))
    return key;

  if (key.substr(0, 6) === '@node/')
    return key;

  var trailingSlash = packageName && key[key.length - 1] !== '/';
  var resolved = applyPaths(config.baseURL, config.paths, trailingSlash ? key + '/' : key);
  if (trailingSlash)
    return resolved.substr(0, resolved.length - 1);
  return resolved;
}

function packageResolveSync (config, key, parentKey, metadata, parentMetadata, skipExtensions) {
  // ignore . since internal maps handled by standard package resolution
  if (parentMetadata && parentMetadata.packageConfig && key[0] !== '.') {
    var parentMap = parentMetadata.packageConfig.map;
    var parentMapMatch = parentMap && getMapMatch(parentMap, key);

    if (parentMapMatch && typeof parentMap[parentMapMatch] === 'string') {
      var mapped = doMapSync(this, config, parentMetadata.packageConfig, parentMetadata.packageKey, parentMapMatch, key, metadata, skipExtensions);
      if (mapped)
        return mapped;
    }
  }

  var normalized = coreResolve.call(this, config, key, parentKey, true, true);

  var pkgConfigMatch = getPackageConfigMatch(config, normalized);
  metadata.packageKey = pkgConfigMatch && pkgConfigMatch.packageKey || getMapMatch(config.packages, normalized);

  if (!metadata.packageKey)
    return normalized;

  if (config.packageConfigKeys.indexOf(normalized) !== -1) {
    metadata.packageKey = undefined;
    return normalized;
  }

  metadata.packageConfig = config.packages[metadata.packageKey] || (config.packages[metadata.packageKey] = createPackage());

  var subPath = normalized.substr(metadata.packageKey.length + 1);

  return applyPackageConfigSync(this, config, metadata.packageConfig, metadata.packageKey, subPath, metadata, skipExtensions);
}

function packageResolve (config, key, parentKey, metadata, parentMetadata, skipExtensions) {
  var loader = this;

  return resolvedPromise
  .then(function () {
    // ignore . since internal maps handled by standard package resolution
    if (parentMetadata && parentMetadata.packageConfig && key.substr(0, 2) !== './') {
      var parentMap = parentMetadata.packageConfig.map;
      var parentMapMatch = parentMap && getMapMatch(parentMap, key);

      if (parentMapMatch)
        return doMap(loader, config, parentMetadata.packageConfig, parentMetadata.packageKey, parentMapMatch, key, metadata, skipExtensions);
    }

    return resolvedPromise;
  })
  .then(function (mapped) {
    if (mapped)
      return mapped;

    // apply map, core, paths, contextual package map
    var normalized = coreResolve.call(loader, config, key, parentKey, true, true);

    var pkgConfigMatch = getPackageConfigMatch(config, normalized);
    metadata.packageKey = pkgConfigMatch && pkgConfigMatch.packageKey || getMapMatch(config.packages, normalized);

    if (!metadata.packageKey)
      return Promise.resolve(normalized);

    if (config.packageConfigKeys.indexOf(normalized) !== -1) {
      metadata.packageKey = undefined;
      metadata.load = createMeta();
      metadata.load.format = 'json';
      // ensure no loader
      metadata.load.loader = '';
      return Promise.resolve(normalized);
    }

    metadata.packageConfig = config.packages[metadata.packageKey] || (config.packages[metadata.packageKey] = createPackage());

    // load configuration when it matches packageConfigPaths, not already configured, and not the config itself
    var loadConfig = pkgConfigMatch && !metadata.packageConfig.configured;

    return (loadConfig ? loadPackageConfigPath(loader, config, pkgConfigMatch.configPath, metadata) : resolvedPromise)
    .then(function () {
      var subPath = normalized.substr(metadata.packageKey.length + 1);

      return applyPackageConfig(loader, config, metadata.packageConfig, metadata.packageKey, subPath, metadata, skipExtensions);
    });
  });
}

function createMeta () {
  return {
    extension: '',
    deps: undefined,
    format: undefined,
    loader: undefined,
    scriptLoad: undefined,
    globals: undefined,
    nonce: undefined,
    integrity: undefined,
    sourceMap: undefined,
    exports: undefined,
    encapsulateGlobal: false,
    crossOrigin: undefined,
    cjsRequireDetection: true,
    cjsDeferDepsExecute: false,
    esModule: false
  };
}

function setMeta (config, key, metadata) {
  metadata.load = metadata.load || createMeta();

  // apply wildcard metas
  var bestDepth = 0;
  var wildcardIndex;
  for (var module in config.meta) {
    wildcardIndex = module.indexOf('*');
    if (wildcardIndex === -1)
      continue;
    if (module.substr(0, wildcardIndex) === key.substr(0, wildcardIndex)
        && module.substr(wildcardIndex + 1) === key.substr(key.length - module.length + wildcardIndex + 1)) {
      var depth = module.split('/').length;
      if (depth > bestDepth)
        bestDepth = depth;
      extendMeta(metadata.load, config.meta[module], bestDepth !== depth);
    }
  }

  // apply exact meta
  if (config.meta[key])
    extendMeta(metadata.load, config.meta[key], false);

  // apply package meta
  if (metadata.packageKey) {
    var subPath = key.substr(metadata.packageKey.length + 1);

    var meta = {};
    if (metadata.packageConfig.meta) {
      var bestDepth = 0;
      getMetaMatches(metadata.packageConfig.meta, subPath, function (metaPattern, matchMeta, matchDepth) {
        if (matchDepth > bestDepth)
          bestDepth = matchDepth;
        extendMeta(meta, matchMeta, matchDepth && bestDepth > matchDepth);
      });

      extendMeta(metadata.load, meta, false);
    }

    // format
    if (metadata.packageConfig.format && !metadata.pluginKey && !metadata.load.loader)
      metadata.load.format = metadata.load.format || metadata.packageConfig.format;
  }
}

function parsePlugin (pluginFirst, key) {
  var argumentKey;
  var pluginKey;

  var pluginIndex = pluginFirst ? key.indexOf('!') : key.lastIndexOf('!');

  if (pluginIndex === -1)
    return;

  if (pluginFirst) {
    argumentKey = key.substr(pluginIndex + 1);
    pluginKey = key.substr(0, pluginIndex);
  }
  else {
    argumentKey = key.substr(0, pluginIndex);
    pluginKey = key.substr(pluginIndex + 1) || argumentKey.substr(argumentKey.lastIndexOf('.') + 1);
  }

  return {
    argument: argumentKey,
    plugin: pluginKey
  };
}

// put key back together after parts have been normalized
function combinePluginParts (pluginFirst, argumentKey, pluginKey) {
  if (pluginFirst)
    return pluginKey + '!' + argumentKey;
  else
    return argumentKey + '!' + pluginKey;
}

/*
 * Package Configuration Extension
 *
 * Example:
 *
 * SystemJS.packages = {
 *   jquery: {
 *     main: 'index.js', // when not set, package key is requested directly
 *     format: 'amd',
 *     defaultExtension: 'ts', // defaults to 'js', can be set to false
 *     modules: {
 *       '*.ts': {
 *         loader: 'typescript'
 *       },
 *       'vendor/sizzle.js': {
 *         format: 'global'
 *       }
 *     },
 *     map: {
 *        // map internal require('sizzle') to local require('./vendor/sizzle')
 *        sizzle: './vendor/sizzle.js',
 *        // map any internal or external require of 'jquery/vendor/another' to 'another/index.js'
 *        './vendor/another.js': './another/index.js',
 *        // test.js / test -> lib/test.js
 *        './test.js': './lib/test.js',
 *
 *        // environment-specific map configurations
 *        './index.js': {
 *          '~browser': './index-node.js',
 *          './custom-condition.js|~export': './index-custom.js'
 *        }
 *     },
 *     // allows for setting package-prefixed depCache
 *     // keys are normalized module keys relative to the package itself
 *     depCache: {
 *       // import 'package/index.js' loads in parallel package/lib/test.js,package/vendor/sizzle.js
 *       './index.js': ['./test'],
 *       './test.js': ['external-dep'],
 *       'external-dep/path.js': ['./another.js']
 *     }
 *   }
 * };
 *
 * Then:
 *   import 'jquery'                       -> jquery/index.js
 *   import 'jquery/submodule'             -> jquery/submodule.js
 *   import 'jquery/submodule.ts'          -> jquery/submodule.ts loaded as typescript
 *   import 'jquery/vendor/another'        -> another/index.js
 *
 * Detailed Behaviours
 * - main can have a leading "./" can be added optionally
 * - map and defaultExtension are applied to the main
 * - defaultExtension adds the extension only if the exact extension is not present

 * - if a meta value is available for a module, map and defaultExtension are skipped
 * - like global map, package map also applies to subpaths (sizzle/x, ./vendor/another/sub)
 * - condition module map is '@env' module in package or '@system-env' globally
 * - map targets support conditional interpolation ('./x': './x.#{|env}.js')
 * - internal package map targets cannot use boolean conditionals
 *
 * Package Configuration Loading
 *
 * Not all packages may already have their configuration present in the System config
 * For these cases, a list of packageConfigPaths can be provided, which when matched against
 * a request, will first request a ".json" file by the package key to derive the package
 * configuration from. This allows dynamic loading of non-predetermined code, a key use
 * case in SystemJS.
 *
 * Example:
 *
 *   SystemJS.packageConfigPaths = ['packages/test/package.json', 'packages/*.json'];
 *
 *   // will first request 'packages/new-package/package.json' for the package config
 *   // before completing the package request to 'packages/new-package/path'
 *   SystemJS.import('packages/new-package/path');
 *
 *   // will first request 'packages/test/package.json' before the main
 *   SystemJS.import('packages/test');
 *
 * When a package matches packageConfigPaths, it will always send a config request for
 * the package configuration.
 * The package key itself is taken to be the match up to and including the last wildcard
 * or trailing slash.
 * The most specific package config path will be used.
 * Any existing package configurations for the package will deeply merge with the
 * package config, with the existing package configurations taking preference.
 * To opt-out of the package configuration request for a package that matches
 * packageConfigPaths, use the { configured: true } package config option.
 *
 */

function addDefaultExtension (config, pkg, pkgKey, subPath, skipExtensions) {
  // don't apply extensions to folders or if defaultExtension = false
  if (!subPath || !pkg.defaultExtension || subPath[subPath.length - 1] === '/' || skipExtensions)
    return subPath;

  var metaMatch = false;

  // exact meta or meta with any content after the last wildcard skips extension
  if (pkg.meta)
    getMetaMatches(pkg.meta, subPath, function (metaPattern, matchMeta, matchDepth) {
      if (matchDepth === 0 || metaPattern.lastIndexOf('*') !== metaPattern.length - 1)
        return metaMatch = true;
    });

  // exact global meta or meta with any content after the last wildcard skips extension
  if (!metaMatch && config.meta)
    getMetaMatches(config.meta, pkgKey + '/' + subPath, function (metaPattern, matchMeta, matchDepth) {
      if (matchDepth === 0 || metaPattern.lastIndexOf('*') !== metaPattern.length - 1)
        return metaMatch = true;
    });

  if (metaMatch)
    return subPath;

  // work out what the defaultExtension is and add if not there already
  var defaultExtension = '.' + pkg.defaultExtension;
  if (subPath.substr(subPath.length - defaultExtension.length) !== defaultExtension)
    return subPath + defaultExtension;
  else
    return subPath;
}

function applyPackageConfigSync (loader, config, pkg, pkgKey, subPath, metadata, skipExtensions) {
  // main
  if (!subPath) {
    if (pkg.main)
      subPath = pkg.main.substr(0, 2) === './' ? pkg.main.substr(2) : pkg.main;
    else
      // also no submap if key is package itself (import 'pkg' -> 'path/to/pkg.js')
      // NB can add a default package main convention here
      // if it becomes internal to the package then it would no longer be an exit path
      return pkgKey;
  }

  // map config checking without then with extensions
  if (pkg.map) {
    var mapPath = './' + subPath;

    var mapMatch = getMapMatch(pkg.map, mapPath);

    // we then check map with the default extension adding
    if (!mapMatch) {
      mapPath = './' + addDefaultExtension(loader, pkg, pkgKey, subPath, skipExtensions);
      if (mapPath !== './' + subPath)
        mapMatch = getMapMatch(pkg.map, mapPath);
    }
    if (mapMatch) {
      var mapped = doMapSync(loader, config, pkg, pkgKey, mapMatch, mapPath, metadata, skipExtensions);
      if (mapped)
        return mapped;
    }
  }

  // normal package resolution
  return pkgKey + '/' + addDefaultExtension(loader, pkg, pkgKey, subPath, skipExtensions);
}

function validMapping (mapMatch, mapped, path) {
  // allow internal ./x -> ./x/y or ./x/ -> ./x/y recursive maps
  // but only if the path is exactly ./x and not ./x/z
  if (mapped.substr(0, mapMatch.length) === mapMatch && path.length > mapMatch.length)
    return false;

  return true;
}

function doMapSync (loader, config, pkg, pkgKey, mapMatch, path, metadata, skipExtensions) {
  if (path[path.length - 1] === '/')
    path = path.substr(0, path.length - 1);
  var mapped = pkg.map[mapMatch];

  if (typeof mapped === 'object')
    throw new Error('Synchronous conditional normalization not supported sync normalizing ' + mapMatch + ' in ' + pkgKey);

  if (!validMapping(mapMatch, mapped, path) || typeof mapped !== 'string')
    return;

  return packageResolveSync.call(this, config, mapped + path.substr(mapMatch.length), pkgKey + '/', metadata, metadata, skipExtensions);
}

function applyPackageConfig (loader, config, pkg, pkgKey, subPath, metadata, skipExtensions) {
  // main
  if (!subPath) {
    if (pkg.main)
      subPath = pkg.main.substr(0, 2) === './' ? pkg.main.substr(2) : pkg.main;
    // also no submap if key is package itself (import 'pkg' -> 'path/to/pkg.js')
    else
      // NB can add a default package main convention here
      // if it becomes internal to the package then it would no longer be an exit path
      return Promise.resolve(pkgKey);
  }

  // map config checking without then with extensions
  var mapPath, mapMatch;

  if (pkg.map) {
    mapPath = './' + subPath;
    mapMatch = getMapMatch(pkg.map, mapPath);

    // we then check map with the default extension adding
    if (!mapMatch) {
      mapPath = './' + addDefaultExtension(loader, pkg, pkgKey, subPath, skipExtensions);
      if (mapPath !== './' + subPath)
        mapMatch = getMapMatch(pkg.map, mapPath);
    }
  }

  return (mapMatch ? doMap(loader, config, pkg, pkgKey, mapMatch, mapPath, metadata, skipExtensions) : resolvedPromise)
  .then(function (mapped) {
    if (mapped)
      return Promise.resolve(mapped);

    // normal package resolution / fallback resolution for no conditional match
    return Promise.resolve(pkgKey + '/' + addDefaultExtension(loader, pkg, pkgKey, subPath, skipExtensions));
  });
}

function doMap (loader, config, pkg, pkgKey, mapMatch, path, metadata, skipExtensions) {
  if (path[path.length - 1] === '/')
    path = path.substr(0, path.length - 1);

  var mapped = pkg.map[mapMatch];

  if (typeof mapped === 'string') {
    if (!validMapping(mapMatch, mapped, path))
      return resolvedPromise;
    return packageResolve.call(loader, config, mapped + path.substr(mapMatch.length), pkgKey + '/', metadata, metadata, skipExtensions)
    .then(function (normalized) {
      return interpolateConditional.call(loader, normalized, pkgKey + '/', metadata);
    });
  }

  // we use a special conditional syntax to allow the builder to handle conditional branch points further
  /*if (loader.builder)
    return Promise.resolve(pkgKey + '/#:' + path);*/

  // we load all conditions upfront
  var conditionPromises = [];
  var conditions = [];
  for (var e in mapped) {
    var c = parseCondition(e);
    conditions.push({
      condition: c,
      map: mapped[e]
    });
    conditionPromises.push(RegisterLoader$1.prototype.import.call(loader, c.module, pkgKey));
  }

  // map object -> conditional map
  return Promise.all(conditionPromises)
  .then(function (conditionValues) {
    // first map condition to match is used
    for (var i = 0; i < conditions.length; i++) {
      var c = conditions[i].condition;
      var value = readMemberExpression(c.prop, conditionValues[i].__useDefault ? conditionValues[i].default : conditionValues[i]);
      if (!c.negate && value || c.negate && !value)
        return conditions[i].map;
    }
  })
  .then(function (mapped) {
    if (mapped) {
      if (!validMapping(mapMatch, mapped, path))
        return resolvedPromise;
      return packageResolve.call(loader, config, mapped + path.substr(mapMatch.length), pkgKey + '/', metadata, metadata, skipExtensions)
      .then(function (normalized) {
        return interpolateConditional.call(loader, normalized, pkgKey + '/', metadata);
      });
    }

    // no environment match -> fallback to original subPath by returning undefined
  });
}

// check if the given normalized key matches a packageConfigPath
// if so, loads the config
var packageConfigPaths = {};

// data object for quick checks against package paths
function createPkgConfigPathObj (path) {
  var lastWildcard = path.lastIndexOf('*');
  var length = Math.max(lastWildcard + 1, path.lastIndexOf('/'));
  return {
    length: length,
    regEx: new RegExp('^(' + path.substr(0, length).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^\\/]+') + ')(\\/|$)'),
    wildcard: lastWildcard !== -1
  };
}

// most specific match wins
function getPackageConfigMatch (config, normalized) {
  var pkgKey, exactMatch = false, configPath;
  for (var i = 0; i < config.packageConfigPaths.length; i++) {
    var packageConfigPath = config.packageConfigPaths[i];
    var p = packageConfigPaths[packageConfigPath] || (packageConfigPaths[packageConfigPath] = createPkgConfigPathObj(packageConfigPath));
    if (normalized.length < p.length)
      continue;
    var match = normalized.match(p.regEx);
    if (match && (!pkgKey || (!(exactMatch && p.wildcard) && pkgKey.length < match[1].length))) {
      pkgKey = match[1];
      exactMatch = !p.wildcard;
      configPath = pkgKey + packageConfigPath.substr(p.length);
    }
  }

  if (!pkgKey)
    return;

  return {
    packageKey: pkgKey,
    configPath: configPath
  };
}

function loadPackageConfigPath (loader, config, pkgConfigPath, metadata, normalized) {
  var configLoader = loader.pluginLoader || loader;

  // ensure we note this is a package config file path
  // it will then be skipped from getting other normalizations itself to ensure idempotency
  if (config.packageConfigKeys.indexOf(pkgConfigPath) === -1)
    config.packageConfigKeys.push(pkgConfigPath);

  return configLoader.import(pkgConfigPath)
  .then(function (pkgConfig) {
    setPkgConfig(metadata.packageConfig, pkgConfig, metadata.packageKey, true, config);
    metadata.packageConfig.configured = true;
  })
  .catch(function (err) {
    throw LoaderError__Check_error_message_for_loader_stack(err, 'Unable to fetch package configuration file ' + pkgConfigPath);
  });
}

function getMetaMatches (pkgMeta, subPath, matchFn) {
  // wildcard meta
  var wildcardIndex;
  for (var module in pkgMeta) {
    // allow meta to start with ./ for flexibility
    var dotRel = module.substr(0, 2) === './' ? './' : '';
    if (dotRel)
      module = module.substr(2);

    wildcardIndex = module.indexOf('*');
    if (wildcardIndex === -1)
      continue;

    if (module.substr(0, wildcardIndex) === subPath.substr(0, wildcardIndex)
        && module.substr(wildcardIndex + 1) === subPath.substr(subPath.length - module.length + wildcardIndex + 1)) {
      // alow match function to return true for an exit path
      if (matchFn(module, pkgMeta[dotRel + module], module.split('/').length))
        return;
    }
  }
  // exact meta
  var exactMeta = pkgMeta[subPath] && Object.hasOwnProperty.call(pkgMeta, subPath) ? pkgMeta[subPath] : pkgMeta['./' + subPath];
  if (exactMeta)
    matchFn(exactMeta, exactMeta, 0);
}


/*
 * Conditions Extension
 *
 *   Allows a condition module to alter the resolution of an import via syntax:
 *
 *     import $ from 'jquery/#{browser}';
 *
 *   Will first load the module 'browser' via `SystemJS.import('browser')` and
 *   take the default export of that module.
 *   If the default export is not a string, an error is thrown.
 *
 *   We then substitute the string into the require to get the conditional resolution
 *   enabling environment-specific variations like:
 *
 *     import $ from 'jquery/ie'
 *     import $ from 'jquery/firefox'
 *     import $ from 'jquery/chrome'
 *     import $ from 'jquery/safari'
 *
 *   It can be useful for a condition module to define multiple conditions.
 *   This can be done via the `|` modifier to specify an export member expression:
 *
 *     import 'jquery/#{./browser.js|grade.version}'
 *
 *   Where the `grade` export `version` member in the `browser.js` module  is substituted.
 *
 *
 * Boolean Conditionals
 *
 *   For polyfill modules, that are used as imports but have no module value,
 *   a binary conditional allows a module not to be loaded at all if not needed:
 *
 *     import 'es5-shim#?./conditions.js|needs-es5shim'
 *
 *   These conditions can also be negated via:
 *
 *     import 'es5-shim#?./conditions.js|~es6'
 *
 */

var sysConditions = ['browser', 'node', 'dev', 'build', 'production', 'default'];

function parseCondition (condition) {
  var conditionExport, conditionModule, negation;

  var negation;
  var conditionExportIndex = condition.lastIndexOf('|');
  if (conditionExportIndex !== -1) {
    conditionExport = condition.substr(conditionExportIndex + 1);
    conditionModule = condition.substr(0, conditionExportIndex);

    if (conditionExport[0] === '~') {
      negation = true;
      conditionExport = conditionExport.substr(1);
    }
  }
  else {
    negation = condition[0] === '~';
    conditionExport = 'default';
    conditionModule = condition.substr(negation);
    if (sysConditions.indexOf(conditionModule) !== -1) {
      conditionExport = conditionModule;
      conditionModule = null;
    }
  }

  return {
    module: conditionModule || '@system-env',
    prop: conditionExport,
    negate: negation
  };
}

function resolveCondition (conditionObj, parentKey, bool) {
  // import without __useDefault handling here
  return RegisterLoader$1.prototype.import.call(this, conditionObj.module, parentKey)
  .then(function (condition) {
    var m = readMemberExpression(conditionObj.prop, condition);

    if (bool && typeof m !== 'boolean')
      throw new TypeError('Condition did not resolve to a boolean.');

    return conditionObj.negate ? !m : m;
  });
}

var interpolationRegEx = /#\{[^\}]+\}/;
function interpolateConditional (key, parentKey, parentMetadata) {
  // first we normalize the conditional
  var conditionalMatch = key.match(interpolationRegEx);

  if (!conditionalMatch)
    return Promise.resolve(key);

  var conditionObj = parseCondition.call(this, conditionalMatch[0].substr(2, conditionalMatch[0].length - 3));

  // in builds, return normalized conditional
  /*if (this.builder)
    return this.normalize(conditionObj.module, parentKey, createMetadata(), parentMetadata)
    .then(function (conditionModule) {
      conditionObj.module = conditionModule;
      return key.replace(interpolationRegEx, '#{' + serializeCondition(conditionObj) + '}');
    });*/

  return resolveCondition.call(this, conditionObj, parentKey, false)
  .then(function (conditionValue) {
    if (typeof conditionValue !== 'string')
      throw new TypeError('The condition value for ' + key + ' doesn\'t resolve to a string.');

    if (conditionValue.indexOf('/') !== -1)
      throw new TypeError('Unabled to interpolate conditional ' + key + (parentKey ? ' in ' + parentKey : '') + '\n\tThe condition value ' + conditionValue + ' cannot contain a "/" separator.');

    return key.replace(interpolationRegEx, conditionValue);
  });
}

/*
 Extend config merging one deep only

  loader.config({
    some: 'random',
    config: 'here',
    deep: {
      config: { too: 'too' }
    }
  });

  <=>

  loader.some = 'random';
  loader.config = 'here'
  loader.deep = loader.deep || {};
  loader.deep.config = { too: 'too' };


  Normalizes meta and package configs allowing for:

  SystemJS.config({
    meta: {
      './index.js': {}
    }
  });

  To become

  SystemJS.meta['https://thissite.com/index.js'] = {};

  For easy normalization canonicalization with latest URL support.

*/
var envConfigNames = ['browserConfig', 'nodeConfig', 'devConfig', 'buildConfig', 'productionConfig'];
function envSet(loader, cfg, envCallback) {
  for (var i = 0; i < envConfigNames.length; i++) {
    var envConfig = envConfigNames[i];
    if (cfg[envConfig] && envModule[envConfig.substr(0, envConfig.length - 6)])
      envCallback(cfg[envConfig]);
  }
}

function cloneObj (obj, maxDepth) {
  var clone = {};
  for (var p in obj) {
    var prop = obj[p];
    if (maxDepth > 1) {
      if (prop instanceof Array)
        clone[p] = [].concat(prop);
      else if (typeof prop === 'object')
        clone[p] = cloneObj(prop, maxDepth - 1);
      else if (p !== 'packageConfig')
        clone[p] = prop;
    }
    else {
      clone[p] = prop;
    }
  }
  return clone;
}

function getConfigItem (config, p) {
  var cfgItem = config[p];

  // getConfig must return an unmodifiable clone of the configuration
  if (cfgItem instanceof Array)
    return config[p].concat([]);
  else if (typeof cfgItem === 'object')
    return cloneObj(cfgItem, 3)
  else
    return config[p];
}

function getConfig (configName) {
  if (configName) {
    if (configNames.indexOf(configName) !== -1)
      return getConfigItem(this[CONFIG], configName);
    throw new Error('"' + configName + '" is not a valid configuration name. Must be one of ' + configNames.join(', ') + '.');
  }

  var cfg = {};
  for (var i = 0; i < configNames.length; i++) {
    var p = configNames[i];
    var configItem = getConfigItem(this[CONFIG], p);
    if (configItem !== undefined)
      cfg[p] = configItem;
  }
  return cfg;
}

function setConfig (cfg, isEnvConfig) {
  var loader = this;
  var config = this[CONFIG];

  if ('warnings' in cfg)
    config.warnings = cfg.warnings;

  if ('wasm' in cfg)
    config.wasm = typeof WebAssembly !== 'undefined' && cfg.wasm;

  if ('production' in cfg || 'build' in cfg)
    setProduction.call(loader, !!cfg.production, !!(cfg.build || envModule && envModule.build));

  if (!isEnvConfig) {
    // if using nodeConfig / browserConfig / productionConfig, take baseURL from there
    // these exceptions will be unnecessary when we can properly implement config queuings
    var baseURL;
    envSet(loader, cfg, function(cfg) {
      baseURL = baseURL || cfg.baseURL;
    });
    baseURL = baseURL || cfg.baseURL;

    // always configure baseURL first
    if (baseURL) {
      config.baseURL = resolveIfNotPlain(baseURL, baseURI) || resolveIfNotPlain('./' + baseURL, baseURI);
      if (config.baseURL[config.baseURL.length - 1] !== '/')
        config.baseURL += '/';
    }

    if (cfg.paths)
      extend(config.paths, cfg.paths);

    envSet(loader, cfg, function(cfg) {
      if (cfg.paths)
        extend(config.paths, cfg.paths);
    });

    for (var p in config.paths) {
      if (config.paths[p].indexOf('*') === -1)
        continue;
      warn.call(config, 'Path config ' + p + ' -> ' + config.paths[p] + ' is no longer supported as wildcards are deprecated.');
      delete config.paths[p];
    }
  }

  if (cfg.defaultJSExtensions)
    warn.call(config, 'The defaultJSExtensions configuration option is deprecated.\n  Use packages defaultExtension instead.', true);

  if (typeof cfg.pluginFirst === 'boolean')
    config.pluginFirst = cfg.pluginFirst;

  if (cfg.map) {
    for (var p in cfg.map) {
      var v = cfg.map[p];

      if (typeof v === 'string') {
        var mapped = coreResolve.call(loader, config, v, undefined, false, false);
        if (mapped[mapped.length -1] === '/' && p[p.length - 1] !== ':' && p[p.length - 1] !== '/')
          mapped = mapped.substr(0, mapped.length - 1);
        config.map[p] = mapped;
      }

      // object map
      else {
        var pkgName = coreResolve.call(loader, config, p[p.length - 1] !== '/' ? p + '/' : p, undefined, true, true);
        pkgName = pkgName.substr(0, pkgName.length - 1);

        var pkg = config.packages[pkgName];
        if (!pkg) {
          pkg = config.packages[pkgName] = createPackage();
          // use '' instead of false to keep type consistent
          pkg.defaultExtension = '';
        }
        setPkgConfig(pkg, { map: v }, pkgName, false, config);
      }
    }
  }

  if (cfg.packageConfigPaths) {
    var packageConfigPaths = [];
    for (var i = 0; i < cfg.packageConfigPaths.length; i++) {
      var path = cfg.packageConfigPaths[i];
      var packageLength = Math.max(path.lastIndexOf('*') + 1, path.lastIndexOf('/'));
      var normalized = coreResolve.call(loader, config, path.substr(0, packageLength), undefined, false, false);
      packageConfigPaths[i] = normalized + path.substr(packageLength);
    }
    config.packageConfigPaths = packageConfigPaths;
  }

  if (cfg.bundles) {
    for (var p in cfg.bundles) {
      var bundle = [];
      for (var i = 0; i < cfg.bundles[p].length; i++)
        bundle.push(loader.normalizeSync(cfg.bundles[p][i]));
      config.bundles[p] = bundle;
    }
  }

  if (cfg.packages) {
    for (var p in cfg.packages) {
      if (p.match(/^([^\/]+:)?\/\/$/))
        throw new TypeError('"' + p + '" is not a valid package name.');

      var pkgName = coreResolve.call(loader, config, p[p.length - 1] !== '/' ? p + '/' : p, undefined, true, true);
      pkgName = pkgName.substr(0, pkgName.length - 1);

      setPkgConfig(config.packages[pkgName] = config.packages[pkgName] || createPackage(), cfg.packages[p], pkgName, false, config);
    }
  }

  if (cfg.depCache) {
    for (var p in cfg.depCache)
      config.depCache[loader.normalizeSync(p)] = [].concat(cfg.depCache[p]);
  }

  if (cfg.meta) {
    for (var p in cfg.meta) {
      // base wildcard stays base
      if (p[0] === '*') {
        extend(config.meta[p] = config.meta[p] || {}, cfg.meta[p]);
      }
      else {
        var resolved = coreResolve.call(loader, config, p, undefined, true, true);
        extend(config.meta[resolved] = config.meta[resolved] || {}, cfg.meta[p]);
      }
    }
  }

  if ('transpiler' in cfg)
    config.transpiler = cfg.transpiler;


  // copy any remaining non-standard configuration properties
  for (var c in cfg) {
    if (configNames.indexOf(c) !== -1)
      continue;
    if (envConfigNames.indexOf(c) !== -1)
      continue;

    // warn.call(config, 'Setting custom config option `System.config({ ' + c + ': ... })` is deprecated. Avoid custom config options or set SystemJS.' + c + ' = ... directly.');
    loader[c] = cfg[c];
  }

  envSet(loader, cfg, function(cfg) {
    loader.config(cfg, true);
  });
}

function createPackage () {
  return {
    defaultExtension: undefined,
    main: undefined,
    format: undefined,
    meta: undefined,
    map: undefined,
    packageConfig: undefined,
    configured: false
  };
}

// deeply-merge (to first level) config with any existing package config
function setPkgConfig (pkg, cfg, pkgName, prependConfig, config) {
  for (var prop in cfg) {
    if (prop === 'main' || prop === 'format' || prop === 'defaultExtension' || prop === 'configured') {
      if (!prependConfig || pkg[prop] === undefined)
        pkg[prop] = cfg[prop];
    }
    else if (prop === 'map') {
      (prependConfig ? prepend : extend)(pkg.map = pkg.map || {}, cfg.map);
    }
    else if (prop === 'meta') {
      (prependConfig ? prepend : extend)(pkg.meta = pkg.meta || {}, cfg.meta);
    }
    else if (Object.hasOwnProperty.call(cfg, prop)) {
      warn.call(config, '"' + prop + '" is not a valid package configuration option in package ' + pkgName);
    }
  }

  // default defaultExtension for packages only
  if (pkg.defaultExtension === undefined)
    pkg.defaultExtension = 'js';

  if (pkg.main === undefined && pkg.map && pkg.map['.']) {
    pkg.main = pkg.map['.'];
    delete pkg.map['.'];
  }
  // main object becomes main map
  else if (typeof pkg.main === 'object') {
    pkg.map = pkg.map || {};
    pkg.map['./@main'] = pkg.main;
    pkg.main['default'] = pkg.main['default'] || './';
    pkg.main = '@main';
  }

  return pkg;
}

var hasBuffer = typeof Buffer !== 'undefined';
try {
  if (hasBuffer && new Buffer('a').toString('base64') !== 'YQ==')
    hasBuffer = false;
}
catch (e) {
  hasBuffer = false;
}

var sourceMapPrefix = '\n//# sourceMapping' + 'URL=data:application/json;base64,';
function inlineSourceMap (sourceMapString) {
  if (hasBuffer)
    return sourceMapPrefix + new Buffer(sourceMapString).toString('base64');
  else if (typeof btoa !== 'undefined')
    return sourceMapPrefix + btoa(unescape(encodeURIComponent(sourceMapString)));
  else
    return '';
}

function getSource(source, sourceMap, address, wrap) {
  var lastLineIndex = source.lastIndexOf('\n');

  if (sourceMap) {
    if (typeof sourceMap != 'object')
      throw new TypeError('load.metadata.sourceMap must be set to an object.');

    sourceMap = JSON.stringify(sourceMap);
  }

  return (wrap ? '(function(System, SystemJS) {' : '') + source + (wrap ? '\n})(System, System);' : '')
      // adds the sourceURL comment if not already present
      + (source.substr(lastLineIndex, 15) != '\n//# sourceURL='
        ? '\n//# sourceURL=' + address + (sourceMap ? '!transpiled' : '') : '')
      // add sourceMappingURL if load.metadata.sourceMap is set
      + (sourceMap && inlineSourceMap(sourceMap) || '');
}

// script execution via injecting a script tag into the page
// this allows CSP nonce to be set for CSP environments
var head;
function scriptExec(loader, source, sourceMap, address, nonce) {
  if (!head)
    head = document.head || document.body || document.documentElement;

  var script = document.createElement('script');
  script.text = getSource(source, sourceMap, address, false);
  var onerror = window.onerror;
  var e;
  window.onerror = function(_e) {
    e = addToError(_e, 'Evaluating ' + address);
    if (onerror)
      onerror.apply(this, arguments);
  };
  preExec(loader);

  if (nonce)
    script.setAttribute('nonce', nonce);

  head.appendChild(script);
  head.removeChild(script);
  postExec();
  window.onerror = onerror;
  if (e)
    return e;
}

var vm;
var useVm;

var curSystem;

var callCounter = 0;
function preExec (loader) {
  if (callCounter++ == 0)
    curSystem = envGlobal.System;
  envGlobal.System = envGlobal.SystemJS = loader;
}
function postExec () {
  if (--callCounter == 0)
    envGlobal.System = envGlobal.SystemJS = curSystem;
}

var supportsScriptExec = false;
if (isBrowser && typeof document != 'undefined' && document.getElementsByTagName) {
  if (!(window.chrome && window.chrome.extension || navigator.userAgent.match(/^Node\.js/)))
    supportsScriptExec = true;
}

function evaluate (loader, source, sourceMap, address, integrity, nonce, noWrap) {
  if (!source)
    return;
  if (nonce && supportsScriptExec)
    return scriptExec(loader, source, sourceMap, address, nonce);
  try {
    preExec(loader);
    // global scoped eval for node (avoids require scope leak)
    if (!vm && loader._nodeRequire) {
      vm = loader._nodeRequire('vm');
      useVm = vm.runInThisContext("typeof System !== 'undefined' && System") === loader;
    }
    if (useVm)
      vm.runInThisContext(getSource(source, sourceMap, address, !noWrap), { filename: address + (sourceMap ? '!transpiled' : '') });
    else
      (0, eval)(getSource(source, sourceMap, address, !noWrap));
    postExec();
  }
  catch (e) {
    postExec();
    return e;
  }
}

var formatHelpers = function (loader) {
  loader.set('@@cjs-helpers', loader.newModule({
    requireResolve: requireResolve.bind(loader),
    getPathVars: getPathVars
  }));

  loader.set('@@global-helpers', loader.newModule({
    prepareGlobal: prepareGlobal
  }));

  /*
    AMD-compatible require
    To copy RequireJS, set window.require = window.requirejs = loader.amdRequire
  */
  function require (names, callback, errback, referer) {
    // in amd, first arg can be a config object... we just ignore
    if (typeof names === 'object' && !(names instanceof Array))
      return require.apply(null, Array.prototype.splice.call(arguments, 1, arguments.length - 1));

    // amd require
    if (typeof names === 'string' && typeof callback === 'function')
      names = [names];
    if (names instanceof Array) {
      var dynamicRequires = [];
      for (var i = 0; i < names.length; i++)
        dynamicRequires.push(loader.import(names[i], referer));
      Promise.all(dynamicRequires).then(function (modules) {
        for (var i = 0; i < modules.length; i++)
          modules[i] = modules[i].__useDefault ? modules[i].default : modules[i];
        if (callback)
          callback.apply(null, modules);
      }, errback);
    }

    // commonjs require
    else if (typeof names === 'string') {
      var normalized = loader.decanonicalize(names, referer);
      var module = loader.get(normalized);
      if (!module)
        throw new Error('Module not already loaded loading "' + names + '" as ' + normalized + (referer ? ' from "' + referer + '".' : '.'));
      return module.__useDefault ? module.default : module;
    }

    else
      throw new TypeError('Invalid require');
  }

  function define (name, deps, factory) {
    if (typeof name !== 'string') {
      factory = deps;
      deps = name;
      name = null;
    }

    if (!(deps instanceof Array)) {
      factory = deps;
      deps = ['require', 'exports', 'module'].splice(0, factory.length);
    }

    if (typeof factory !== 'function')
      factory = (function (factory) {
        return function() { return factory; }
      })(factory);

    if (!name) {
      if (curMetaDeps) {
        deps = deps.concat(curMetaDeps);
        curMetaDeps = undefined;
      }
    }

    // remove system dependencies
    var requireIndex, exportsIndex, moduleIndex;

    if ((requireIndex = deps.indexOf('require')) !== -1) {

      deps.splice(requireIndex, 1);

      // only trace cjs requires for non-named
      // named defines assume the trace has already been done
      if (!name)
        deps = deps.concat(amdGetCJSDeps(factory.toString(), requireIndex));
    }

    if ((exportsIndex = deps.indexOf('exports')) !== -1)
      deps.splice(exportsIndex, 1);

    if ((moduleIndex = deps.indexOf('module')) !== -1)
      deps.splice(moduleIndex, 1);

    function execute (req, exports, module) {
      var depValues = [];
      for (var i = 0; i < deps.length; i++)
        depValues.push(req(deps[i]));

      module.uri = module.id;

      module.config = noop;

      // add back in system dependencies
      if (moduleIndex !== -1)
        depValues.splice(moduleIndex, 0, module);

      if (exportsIndex !== -1)
        depValues.splice(exportsIndex, 0, exports);

      if (requireIndex !== -1) {
        var contextualRequire = function (names, callback, errback) {
          if (typeof names === 'string' && typeof callback !== 'function')
            return req(names);
          return require.call(loader, names, callback, errback, module.id);
        };
        contextualRequire.toUrl = function (name) {
          return loader.normalizeSync(name, module.id);
        };
        depValues.splice(requireIndex, 0, contextualRequire);
      }

      // set global require to AMD require
      var curRequire = envGlobal.require;
      envGlobal.require = require;

      var output = factory.apply(exportsIndex === -1 ? envGlobal : exports, depValues);

      envGlobal.require = curRequire;

      if (typeof output !== 'undefined')
        module.exports = output;
    }

    // anonymous define
    if (!name) {
      loader.registerDynamic(deps, false, curEsModule ? wrapEsModuleExecute(execute) : execute);
    }
    else {
      loader.registerDynamic(name, deps, false, execute);

      // if we don't have any other defines,
      // then let this be an anonymous define
      // this is just to support single modules of the form:
      // define('jquery')
      // still loading anonymously
      // because it is done widely enough to be useful
      // as soon as there is more than one define, this gets removed though
      if (lastNamedDefine) {
        lastNamedDefine = undefined;
        multipleNamedDefines = true;
      }
      else if (!multipleNamedDefines) {
        lastNamedDefine = [deps, execute];
      }
    }
  }
  define.amd = {};

  loader.amdDefine = define;
  loader.amdRequire = require;
};

// CJS
var windowOrigin;
if (typeof window !== 'undefined' && typeof document !== 'undefined' && window.location)
  windowOrigin = location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '');

function stripOrigin(path) {
  if (path.substr(0, 8) === 'file:///')
    return path.substr(7 + !!isWindows);

  if (windowOrigin && path.substr(0, windowOrigin.length) === windowOrigin)
    return path.substr(windowOrigin.length);

  return path;
}

function requireResolve (request, parentId) {
  return stripOrigin(this.normalizeSync(request, parentId));
}

function getPathVars (moduleId) {
  // remove any plugin syntax
  var pluginIndex = moduleId.lastIndexOf('!');
  var filename;
  if (pluginIndex !== -1)
    filename = moduleId.substr(0, pluginIndex);
  else
    filename = moduleId;

  var dirname = filename.split('/');
  dirname.pop();
  dirname = dirname.join('/');

  return {
    filename: stripOrigin(filename),
    dirname: stripOrigin(dirname)
  };
}

var commentRegEx$1 = /(^|[^\\])(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg;
var stringRegEx$1 = /("[^"\\\n\r]*(\\.[^"\\\n\r]*)*"|'[^'\\\n\r]*(\\.[^'\\\n\r]*)*')/g;

// extract CJS dependencies from source text via regex static analysis
// read require('x') statements not in comments or strings
function getCJSDeps (source) {
  cjsRequireRegEx.lastIndex = commentRegEx$1.lastIndex = stringRegEx$1.lastIndex = 0;

  var deps = [];

  var match;

  // track string and comment locations for unminified source
  var stringLocations = [], commentLocations = [];

  function inLocation (locations, match) {
    for (var i = 0; i < locations.length; i++)
      if (locations[i][0] < match.index && locations[i][1] > match.index)
        return true;
    return false;
  }

  if (source.length / source.split('\n').length < 200) {
    while (match = stringRegEx$1.exec(source))
      stringLocations.push([match.index, match.index + match[0].length]);

    // TODO: track template literals here before comments

    while (match = commentRegEx$1.exec(source)) {
      // only track comments not starting in strings
      if (!inLocation(stringLocations, match))
        commentLocations.push([match.index + match[1].length, match.index + match[0].length - 1]);
    }
  }

  while (match = cjsRequireRegEx.exec(source)) {
    // ensure we're not within a string or comment location
    if (!inLocation(stringLocations, match) && !inLocation(commentLocations, match)) {
      var dep = match[1].substr(1, match[1].length - 2);
      // skip cases like require('" + file + "')
      if (dep.match(/"|'/))
        continue;
      deps.push(dep);
    }
  }

  return deps;
}

// Global
// bare minimum ignores
var ignoredGlobalProps = ['_g', 'sessionStorage', 'localStorage', 'clipboardData', 'frames', 'frameElement', 'external',
  'mozAnimationStartTime', 'webkitStorageInfo', 'webkitIndexedDB', 'mozInnerScreenY', 'mozInnerScreenX'];

var globalSnapshot;
function globalIterator (globalName) {
  if (ignoredGlobalProps.indexOf(globalName) !== -1)
    return;
  try {
    var value = envGlobal[globalName];
  }
  catch (e) {
    ignoredGlobalProps.push(globalName);
  }
  this(globalName, value);
}

function getGlobalValue (exports) {
  if (typeof exports === 'string')
    return readMemberExpression(exports, envGlobal);

  if (!(exports instanceof Array))
    throw new Error('Global exports must be a string or array.');

  var globalValue = {};
  for (var i = 0; i < exports.length; i++)
    globalValue[exports[i].split('.').pop()] = readMemberExpression(exports[i], envGlobal);
  return globalValue;
}

function prepareGlobal (moduleName, exports, globals, encapsulate) {
  // disable module detection
  var curDefine = envGlobal.define;

  envGlobal.define = undefined;

  // set globals
  var oldGlobals;
  if (globals) {
    oldGlobals = {};
    for (var g in globals) {
      oldGlobals[g] = envGlobal[g];
      envGlobal[g] = globals[g];
    }
  }

  // store a complete copy of the global object in order to detect changes
  if (!exports) {
    globalSnapshot = {};

    Object.keys(envGlobal).forEach(globalIterator, function (name, value) {
      globalSnapshot[name] = value;
    });
  }

  // return function to retrieve global
  return function () {
    var globalValue = exports ? getGlobalValue(exports) : {};

    var singleGlobal;
    var multipleExports = !!exports;

    if (!exports || encapsulate)
      Object.keys(envGlobal).forEach(globalIterator, function (name, value) {
        if (globalSnapshot[name] === value)
          return;
        if (value === undefined)
          return;

        // allow global encapsulation where globals are removed
        if (encapsulate)
          envGlobal[name] = undefined;

        if (!exports) {
          globalValue[name] = value;

          if (singleGlobal !== undefined) {
            if (!multipleExports && singleGlobal !== value)
              multipleExports = true;
          }
          else {
            singleGlobal = value;
          }
        }
      });

    globalValue = multipleExports ? globalValue : singleGlobal;

    // revert globals
    if (oldGlobals) {
      for (var g in oldGlobals)
        envGlobal[g] = oldGlobals[g];
    }
    envGlobal.define = curDefine;

    return globalValue;
  };
}

// AMD
var cjsRequirePre = "(?:^|[^$_a-zA-Z\\xA0-\\uFFFF.])";
var cjsRequirePost = "\\s*\\(\\s*(\"([^\"]+)\"|'([^']+)')\\s*\\)";
var fnBracketRegEx = /\(([^\)]*)\)/;
var wsRegEx = /^\s+|\s+$/g;

var requireRegExs = {};

function amdGetCJSDeps(source, requireIndex) {

  // remove comments
  source = source.replace(commentRegEx$1, '');

  // determine the require alias
  var params = source.match(fnBracketRegEx);
  var requireAlias = (params[1].split(',')[requireIndex] || 'require').replace(wsRegEx, '');

  // find or generate the regex for this requireAlias
  var requireRegEx = requireRegExs[requireAlias] || (requireRegExs[requireAlias] = new RegExp(cjsRequirePre + requireAlias + cjsRequirePost, 'g'));

  requireRegEx.lastIndex = 0;

  var deps = [];

  var match;
  while (match = requireRegEx.exec(source))
    deps.push(match[2] || match[3]);

  return deps;
}

function wrapEsModuleExecute (execute) {
  return function (require, exports, module) {
    execute(require, exports, module);
    exports = module.exports;
    if ((typeof exports === 'object' || typeof exports === 'function') && !('__esModule' in exports))
      Object.defineProperty(module.exports, '__esModule', {
        value: true
      });
  };
}

// generate anonymous define from singular named define
var multipleNamedDefines = false;
var lastNamedDefine;
var curMetaDeps;
var curEsModule = false;
function clearLastDefine (metaDeps, esModule) {
  curMetaDeps = metaDeps;
  curEsModule = esModule;
  lastNamedDefine = undefined;
  multipleNamedDefines = false;
}
function registerLastDefine (loader) {
  if (lastNamedDefine)
    loader.registerDynamic(curMetaDeps ? lastNamedDefine[0].concat(curMetaDeps) : lastNamedDefine[0],
        false, curEsModule ? wrapEsModuleExecute(lastNamedDefine[1]) : lastNamedDefine[1]);

  // bundles are an empty module
  else if (multipleNamedDefines)
    loader.registerDynamic([], false, noop);
}

var supportsScriptLoad = (isBrowser || isWorker) && typeof navigator !== 'undefined' && navigator.userAgent && !navigator.userAgent.match(/MSIE (9|10).0/);

// include the node require since we're overriding it
var nodeRequire;
if (typeof require !== 'undefined' && typeof process !== 'undefined' && !process.browser)
  nodeRequire = require;

function setMetaEsModule (metadata, moduleValue) {
  if (metadata.load.esModule && (typeof moduleValue === 'object' || typeof moduleValue === 'function') &&
      !('__esModule' in moduleValue))
    Object.defineProperty(moduleValue, '__esModule', {
      value: true
    });
}

function instantiate$1 (key, processAnonRegister) {
  var loader = this;
  var config = this[CONFIG];
  // first do bundles and depCache
  return (loadBundlesAndDepCache(config, this, key) || resolvedPromise)
  .then(function () {
    if (processAnonRegister())
      return;

    var metadata = loader[METADATA][key];

    // node module loading
    if (key.substr(0, 6) === '@node/') {
      if (!loader._nodeRequire)
        throw new TypeError('Error loading ' + key + '. Can only load node core modules in Node.');
      loader.registerDynamic([], false, function () {
        return loadNodeModule.call(loader, key.substr(6), loader.baseURL);
      });
      processAnonRegister();
      return;
    }

    if (metadata.load.scriptLoad ) {
      if (metadata.load.pluginKey || !supportsScriptLoad) {
        metadata.load.scriptLoad = false;
        warn.call(config, 'scriptLoad not supported for "' + key + '"');
      }
    }
    else if (metadata.load.scriptLoad !== false && !metadata.load.pluginKey && supportsScriptLoad) {
      // auto script load AMD, global without deps
      if (!metadata.load.deps && !metadata.load.globals &&
          (metadata.load.format === 'system' || metadata.load.format === 'register' || metadata.load.format === 'global' && metadata.load.exports))
        metadata.load.scriptLoad = true;
    }

    // fetch / translate / instantiate pipeline
    if (!metadata.load.scriptLoad)
      return initializePlugin(loader, key, metadata)
      .then(function () {
        return runFetchPipeline(loader, key, metadata, processAnonRegister, config.wasm);
      })

    // just script loading
    return new Promise(function (resolve, reject) {
      if (metadata.load.format === 'amd' && envGlobal.define !== loader.amdDefine)
        throw new Error('Loading AMD with scriptLoad requires setting the global `' + globalName + '.define = SystemJS.amdDefine`');

      scriptLoad(key, metadata.load.crossOrigin, metadata.load.integrity, function () {
        if (!processAnonRegister()) {
          metadata.load.format = 'global';
          var globalValue = metadata.load.exports && getGlobalValue(metadata.load.exports);
          loader.registerDynamic([], false, function () {
            setMetaEsModule(metadata, globalValue);
            return globalValue;
          });
          processAnonRegister();
        }

        resolve();
      }, reject);
    });
  })
  .then(function (instantiated) {
    delete loader[METADATA][key];
    return instantiated;
  });
}

function initializePlugin (loader, key, metadata) {
  if (!metadata.pluginKey)
    return resolvedPromise;

  return loader.import(metadata.pluginKey).then(function (plugin) {
    metadata.pluginModule = plugin;
    metadata.pluginLoad = {
      name: key,
      address: metadata.pluginArgument,
      source: undefined,
      metadata: metadata.load
    };
    metadata.load.deps = metadata.load.deps || [];
  });
}

function loadBundlesAndDepCache (config, loader, key) {
  // load direct deps, in turn will pick up their trace trees
  var deps = config.depCache[key];
  if (deps) {
    for (var i = 0; i < deps.length; i++)
      loader.normalize(deps[i], key).then(preloadScript);
  }
  else {
    var matched = false;
    for (var b in config.bundles) {
      for (var i = 0; i < config.bundles[b].length; i++) {
        var curModule = config.bundles[b][i];

        if (curModule === key) {
          matched = true;
          break;
        }

        // wildcard in bundles includes / boundaries
        if (curModule.indexOf('*') !== -1) {
          var parts = curModule.split('*');
          if (parts.length !== 2) {
            config.bundles[b].splice(i--, 1);
            continue;
          }

          if (key.substr(0, parts[0].length) === parts[0] &&
              key.substr(key.length - parts[1].length, parts[1].length) === parts[1]) {
            matched = true;
            break;
          }
        }
      }

      if (matched)
        return loader.import(b);
    }
  }
}

function runFetchPipeline (loader, key, metadata, processAnonRegister, wasm) {
  if (metadata.load.exports && !metadata.load.format)
    metadata.load.format = 'global';

  return resolvedPromise

  // locate
  .then(function () {
    if (!metadata.pluginModule || !metadata.pluginModule.locate)
      return;

    return Promise.resolve(metadata.pluginModule.locate.call(loader, metadata.pluginLoad))
    .then(function (address) {
      if (address)
        metadata.pluginLoad.address = address;
    });
  })

  // fetch
  .then(function () {
    if (!metadata.pluginModule)
      return fetch$1(key, metadata.load.authorization, metadata.load.integrity, wasm);

    wasm = false;

    if (!metadata.pluginModule.fetch)
      return fetch$1(metadata.pluginLoad.address, metadata.load.authorization, metadata.load.integrity, false);

    return metadata.pluginModule.fetch.call(loader, metadata.pluginLoad, function (load) {
      return fetch$1(load.address, metadata.load.authorization, metadata.load.integrity, false);
    });
  })

  .then(function (fetched) {
    // fetch is already a utf-8 string if not doing wasm detection
    if (!wasm || typeof fetched === 'string')
      return translateAndInstantiate(loader, key, fetched, metadata, processAnonRegister);

    return checkInstantiateWasm(loader, fetched, processAnonRegister)
    .then(function (wasmInstantiated) {
      if (wasmInstantiated)
        return;

      // not wasm -> convert buffer into utf-8 string to execute as a module
      // TextDecoder compatibility matches WASM currently. Need to keep checking this.
      // The TextDecoder interface is documented at http://encoding.spec.whatwg.org/#interface-textdecoder
      var stringSource = isBrowser ? new TextDecoder('utf-8').decode(new Uint8Array(fetched)) : fetched.toString();
      return translateAndInstantiate(loader, key, stringSource, metadata, processAnonRegister);
    });
  });
}

function translateAndInstantiate (loader, key, source, metadata, processAnonRegister) {
  return Promise.resolve(source)
  // translate
  .then(function (source) {
    if (metadata.load.format === 'detect')
      metadata.load.format = undefined;

    readMetaSyntax(source, metadata);

    if (!metadata.pluginModule || !metadata.pluginModule.translate)
      return source;

    metadata.pluginLoad.source = source;
    return Promise.resolve(metadata.pluginModule.translate.call(loader, metadata.pluginLoad, metadata.traceOpts))
    .then(function (translated) {
      if (metadata.load.sourceMap) {
        if (typeof metadata.load.sourceMap !== 'object')
          throw new Error('metadata.load.sourceMap must be set to an object.');
        sanitizeSourceMap(metadata.pluginLoad.address, metadata.load.sourceMap);
      }

      if (typeof translated === 'string')
        return translated;
      else
        return metadata.pluginLoad.source;
    });
  })
  .then(function (source) {
    if (!metadata.load.format && source.substring(0, 8) === '"bundle"') {
      metadata.load.format = 'system';
      return source;
    }

    if (metadata.load.format === 'register' || !metadata.load.format && detectRegisterFormat(source)) {
      metadata.load.format = 'register';
      return source;
    }

    if (metadata.load.format !== 'esm' && (metadata.load.format || !source.match(esmRegEx))) {
      return source;
    }

    metadata.load.format = 'esm';
    return transpile(loader, source, key, metadata, processAnonRegister);
  })

  // instantiate
  .then(function (translated) {
    if (typeof translated !== 'string' || !metadata.pluginModule || !metadata.pluginModule.instantiate)
      return translated;

    var calledInstantiate = false;
    metadata.pluginLoad.source = translated;
    return Promise.resolve(metadata.pluginModule.instantiate.call(loader, metadata.pluginLoad, function (load) {
      translated = load.source;
      metadata.load = load.metadata;
      if (calledInstantiate)
        throw new Error('Instantiate must only be called once.');
      calledInstantiate = true;
    }))
    .then(function (result) {
      if (calledInstantiate)
        return translated;
      return protectedCreateNamespace(result);
    });
  })
  .then(function (source) {
    // plugin instantiate result case
    if (typeof source !== 'string')
      return source;

    if (!metadata.load.format)
      metadata.load.format = detectLegacyFormat(source);

    var registered = false;

    switch (metadata.load.format) {
      case 'esm':
      case 'register':
      case 'system':
        var err = evaluate(loader, source, metadata.load.sourceMap, key, metadata.load.integrity, metadata.load.nonce, false);
        if (err)
          throw err;
        if (!processAnonRegister())
          return emptyModule;
        return;
      break;

      case 'json':
        // warn.call(config, '"json" module format is deprecated.');
        return loader.newModule({ default: JSON.parse(source), __useDefault: true });

      case 'amd':
        var curDefine = envGlobal.define;
        envGlobal.define = loader.amdDefine;

        clearLastDefine(metadata.load.deps, metadata.load.esModule);

        var err = evaluate(loader, source, metadata.load.sourceMap, key, metadata.load.integrity, metadata.load.nonce, false);

        // if didn't register anonymously, use the last named define if only one
        registered = processAnonRegister();
        if (!registered) {
          registerLastDefine(loader);
          registered = processAnonRegister();
        }

        envGlobal.define = curDefine;

        if (err)
          throw err;
      break;

      case 'cjs':
        var metaDeps = metadata.load.deps;
        var deps = (metadata.load.deps || []).concat(metadata.load.cjsRequireDetection ? getCJSDeps(source) : []);

        for (var g in metadata.load.globals)
          if (metadata.load.globals[g])
            deps.push(metadata.load.globals[g]);

        loader.registerDynamic(deps, true, function (require, exports, module) {
          require.resolve = function (key) {
            return requireResolve.call(loader, key, module.id);
          };
          // support module.paths ish
          module.paths = [];
          module.require = require;

          // ensure meta deps execute first
          if (!metadata.load.cjsDeferDepsExecute && metaDeps)
            for (var i = 0; i < metaDeps.length; i++)
              require(metaDeps[i]);

          var pathVars = getPathVars(module.id);
          var __cjsWrapper = {
            exports: exports,
            args: [require, exports, module, pathVars.filename, pathVars.dirname, envGlobal, envGlobal]
          };

          var cjsWrapper = "(function (require, exports, module, __filename, __dirname, global, GLOBAL";

          // add metadata.globals to the wrapper arguments
          if (metadata.load.globals)
            for (var g in metadata.load.globals) {
              __cjsWrapper.args.push(require(metadata.load.globals[g]));
              cjsWrapper += ", " + g;
            }

          // disable AMD detection
          var define = envGlobal.define;
          envGlobal.define = undefined;
          envGlobal.__cjsWrapper = __cjsWrapper;

          source = cjsWrapper + ") {" + source.replace(hashBangRegEx, '') + "\n}).apply(__cjsWrapper.exports, __cjsWrapper.args);";

          var err = evaluate(loader, source, metadata.load.sourceMap, key, metadata.load.integrity, metadata.load.nonce, false);
          if (err)
            throw err;

          setMetaEsModule(metadata, exports);

          envGlobal.__cjsWrapper = undefined;
          envGlobal.define = define;
        });
        registered = processAnonRegister();
      break;

      case 'global':
        var deps = metadata.load.deps || [];
        for (var g in metadata.load.globals) {
          var gl = metadata.load.globals[g];
          if (gl)
            deps.push(gl);
        }

        loader.registerDynamic(deps, false, function (require, exports, module) {
          var globals;
          if (metadata.load.globals) {
            globals = {};
            for (var g in metadata.load.globals)
              if (metadata.load.globals[g])
                globals[g] = require(metadata.load.globals[g]);
          }

          var exportName = metadata.load.exports;

          if (exportName)
            source += '\n' + globalName + '["' + exportName + '"] = ' + exportName + ';';

          var retrieveGlobal = prepareGlobal(module.id, exportName, globals, metadata.load.encapsulateGlobal);
          var err = evaluate(loader, source, metadata.load.sourceMap, key, metadata.load.integrity, metadata.load.nonce, true);

          if (err)
            throw err;

          var output = retrieveGlobal();
          setMetaEsModule(metadata, output);
          return output;
        });
        registered = processAnonRegister();
      break;

      default:
        throw new TypeError('Unknown module format "' + metadata.load.format + '" for "' + key + '".' + (metadata.load.format === 'es6' ? ' Use "esm" instead here.' : ''));
    }

    if (!registered)
      throw new Error('Module ' + key + ' detected as ' + metadata.load.format + ' but didn\'t execute correctly.');
  });
}

var globalName = typeof self != 'undefined' ? 'self' : 'global';

// good enough ES6 module detection regex - format detections not designed to be accurate, but to handle the 99% use case
var esmRegEx = /(^\s*|[}\);\n]\s*)(import\s*(['"]|(\*\s+as\s+)?[^"'\(\)\n;]+\s*from\s*['"]|\{)|export\s+\*\s+from\s+["']|export\s*(\{|default|function|class|var|const|let|async\s+function))/;

var leadingCommentAndMetaRegEx = /^(\s*\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*|\s*"[^"]+"\s*;?|\s*'[^']+'\s*;?)*\s*/;
function detectRegisterFormat(source) {
  var leadingCommentAndMeta = source.match(leadingCommentAndMetaRegEx);
  return leadingCommentAndMeta && source.substr(leadingCommentAndMeta[0].length, 15) === 'System.register';
}

// AMD Module Format Detection RegEx
// define([.., .., ..], ...)
// define(varName); || define(function(require, exports) {}); || define({})
var amdRegEx = /(?:^\uFEFF?|[^$_a-zA-Z\xA0-\uFFFF.])define\s*\(\s*("[^"]+"\s*,\s*|'[^']+'\s*,\s*)?\s*(\[(\s*(("[^"]+"|'[^']+')\s*,|\/\/.*\r?\n|\/\*(.|\s)*?\*\/))*(\s*("[^"]+"|'[^']+')\s*,?)?(\s*(\/\/.*\r?\n|\/\*(.|\s)*?\*\/))*\s*\]|function\s*|{|[_$a-zA-Z\xA0-\uFFFF][_$a-zA-Z0-9\xA0-\uFFFF]*\))/;

/// require('...') || exports[''] = ... || exports.asd = ... || module.exports = ...
var cjsExportsRegEx = /(?:^\uFEFF?|[^$_a-zA-Z\xA0-\uFFFF.])(exports\s*(\[['"]|\.)|module(\.exports|\['exports'\]|\["exports"\])\s*(\[['"]|[=,\.]))/;
// used to support leading #!/usr/bin/env in scripts as supported in Node
var hashBangRegEx = /^\#\!.*/;

function detectLegacyFormat (source) {
  if (source.match(amdRegEx))
    return 'amd';

  cjsExportsRegEx.lastIndex = 0;
  cjsRequireRegEx.lastIndex = 0;
  if (cjsRequireRegEx.exec(source) || cjsExportsRegEx.exec(source))
    return 'cjs';

  // global is the fallback format
  return 'global';
}

function sanitizeSourceMap (address, sourceMap) {
  var originalName = address.split('!')[0];

  // force set the filename of the original file
  if (!sourceMap.file || sourceMap.file == address)
    sourceMap.file = originalName + '!transpiled';

  // force set the sources list if only one source
  if (!sourceMap.sources || sourceMap.sources.length <= 1 && (!sourceMap.sources[0] || sourceMap.sources[0] === address))
    sourceMap.sources = [originalName];
}

function transpile (loader, source, key, metadata, processAnonRegister) {
  if (!loader.transpiler)
    throw new TypeError('Unable to dynamically transpile ES module\n   A loader plugin needs to be configured via `SystemJS.config({ transpiler: \'transpiler-module\' })`.');

  // deps support for es transpile
  if (metadata.load.deps) {
    var depsPrefix = '';
    for (var i = 0; i < metadata.load.deps.length; i++)
      depsPrefix += 'import "' + metadata.load.deps[i] + '"; ';
    source = depsPrefix + source;
  }

  // do transpilation
  return loader.import.call(loader, loader.transpiler)
  .then(function (transpiler) {
    if (transpiler.__useDefault)
      transpiler = transpiler.default;

    // translate hooks means this is a transpiler plugin instead of a raw implementation
    if (!transpiler.translate)
      throw new Error(loader.transpiler + ' is not a valid transpiler plugin.');

    // if transpiler is the same as the plugin loader, then don't run twice
    if (transpiler === metadata.pluginModule)
      return source;

    // convert the source map into an object for transpilation chaining
    if (typeof metadata.load.sourceMap === 'string')
      metadata.load.sourceMap = JSON.parse(metadata.load.sourceMap);

    metadata.pluginLoad = metadata.pluginLoad || {
      name: key,
      address: key,
      source: source,
      metadata: metadata.load
    };
    metadata.load.deps = metadata.load.deps || [];

    return Promise.resolve(transpiler.translate.call(loader, metadata.pluginLoad, metadata.traceOpts))
    .then(function (source) {
      // sanitize sourceMap if an object not a JSON string
      var sourceMap = metadata.load.sourceMap;
      if (sourceMap && typeof sourceMap === 'object')
        sanitizeSourceMap(key, sourceMap);

      if (metadata.load.format === 'esm' && detectRegisterFormat(source))
        metadata.load.format = 'register';

      return source;
    });
  }, function (err) {
    throw LoaderError__Check_error_message_for_loader_stack(err, 'Unable to load transpiler to transpile ' + key);
  });
}

// detect any meta header syntax
// only set if not already set
var metaRegEx = /^(\s*\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\s*\/\/[^\n]*|\s*"[^"]+"\s*;?|\s*'[^']+'\s*;?)+/;
var metaPartRegEx = /\/\*[^\*]*(\*(?!\/)[^\*]*)*\*\/|\/\/[^\n]*|"[^"]+"\s*;?|'[^']+'\s*;?/g;

function setMetaProperty(target, p, value) {
  var pParts = p.split('.');
  var curPart;
  while (pParts.length > 1) {
    curPart = pParts.shift();
    target = target[curPart] = target[curPart] || {};
  }
  curPart = pParts.shift();
  if (target[curPart] === undefined)
    target[curPart] = value;
}

function readMetaSyntax (source, metadata) {
  var meta = source.match(metaRegEx);
  if (!meta)
    return;

  var metaParts = meta[0].match(metaPartRegEx);

  for (var i = 0; i < metaParts.length; i++) {
    var curPart = metaParts[i];
    var len = curPart.length;

    var firstChar = curPart.substr(0, 1);
    if (curPart.substr(len - 1, 1) == ';')
      len--;

    if (firstChar != '"' && firstChar != "'")
      continue;

    var metaString = curPart.substr(1, curPart.length - 3);
    var metaName = metaString.substr(0, metaString.indexOf(' '));

    if (metaName) {
      var metaValue = metaString.substr(metaName.length + 1, metaString.length - metaName.length - 1);

      if (metaName === 'deps')
        metaName = 'deps[]';

      if (metaName.substr(metaName.length - 2, 2) === '[]') {
        metaName = metaName.substr(0, metaName.length - 2);
        metadata.load[metaName] = metadata.load[metaName] || [];
        metadata.load[metaName].push(metaValue);
      }
      // "use strict" is not meta
      else if (metaName !== 'use') {
        setMetaProperty(metadata.load, metaName, metaValue);
      }
    }
    else {
      metadata.load[metaString] = true;
    }
  }
}

var scriptSrc;

// Promise detection and error message
if (typeof Promise === 'undefined')
  throw new Error('SystemJS needs a Promise polyfill.');

if (typeof document !== 'undefined') {
  var scripts = document.getElementsByTagName('script');
  var curScript = scripts[scripts.length - 1];
  if (document.currentScript && (curScript.defer || curScript.async))
    curScript = document.currentScript;

  scriptSrc = curScript && curScript.src;
}
// worker
else if (typeof importScripts !== 'undefined') {
  try {
    throw new Error('_');
  }
  catch (e) {
    e.stack.replace(/(?:at|@).*(http.+):[\d]+:[\d]+/, function(m, url) {
      scriptSrc = url;
    });
  }
}
// node
else if (typeof __filename !== 'undefined') {
  scriptSrc = __filename;
}

function SystemJSLoader$1 () {
  RegisterLoader$1.call(this);

  // NB deprecate
  this._loader = {};

  // internal metadata store
  this[METADATA] = {};

  // internal configuration
  this[CONFIG] = {
    baseURL: baseURI,
    paths: {},

    packageConfigPaths: [],
    packageConfigKeys: [],
    map: {},
    packages: {},
    depCache: {},
    meta: {},
    bundles: {},

    production: false,

    transpiler: undefined,
    loadedBundles: {},

    // global behaviour flags
    warnings: false,
    pluginFirst: false,

    // enable wasm loading and detection when supported
    wasm: false
  };

  // make the location of the system.js script accessible (if any)
  this.scriptSrc = scriptSrc;

  this._nodeRequire = nodeRequire;

  // support the empty module, as a concept
  this.registry.set('@empty', emptyModule);

  setProduction.call(this, false, false);

  // add module format helpers
  formatHelpers(this);
}

var envModule;
function setProduction (isProduction, isBuilder) {
  this[CONFIG].production = isProduction;
  this.registry.set('@system-env', envModule = this.newModule({
    browser: isBrowser,
    node: !!this._nodeRequire,
    production: !isBuilder && isProduction,
    dev: isBuilder || !isProduction,
    build: isBuilder,
    'default': true
  }));
}

SystemJSLoader$1.prototype = Object.create(RegisterLoader$1.prototype);

SystemJSLoader$1.prototype.constructor = SystemJSLoader$1;

// NB deprecate normalize
SystemJSLoader$1.prototype[SystemJSLoader$1.resolve = RegisterLoader$1.resolve] = SystemJSLoader$1.prototype.normalize = normalize;

SystemJSLoader$1.prototype.load = function (key, parentKey) {
  warn.call(this[CONFIG], 'System.load is deprecated.');
  return this.import(key, parentKey);
};

// NB deprecate decanonicalize, normalizeSync
SystemJSLoader$1.prototype.decanonicalize = SystemJSLoader$1.prototype.normalizeSync = SystemJSLoader$1.prototype.resolveSync = normalizeSync;

SystemJSLoader$1.prototype[SystemJSLoader$1.instantiate = RegisterLoader$1.instantiate] = instantiate$1;

SystemJSLoader$1.prototype.config = setConfig;
SystemJSLoader$1.prototype.getConfig = getConfig;

SystemJSLoader$1.prototype.global = envGlobal;

SystemJSLoader$1.prototype.import = function () {
  return RegisterLoader$1.prototype.import.apply(this, arguments)
  .then(function (m) {
    return m.__useDefault ? m.default: m;
  });
};

var configNames = ['baseURL', 'map', 'paths', 'packages', 'packageConfigPaths', 'depCache', 'meta', 'bundles', 'transpiler', 'warnings', 'pluginFirst', 'production', 'wasm'];

var hasProxy = typeof Proxy !== 'undefined';
for (var i = 0; i < configNames.length; i++) (function (configName) {
  Object.defineProperty(SystemJSLoader$1.prototype, configName, {
    get: function () {
      var cfg = getConfigItem(this[CONFIG], configName);

      if (hasProxy && typeof cfg === 'object')
        cfg = new Proxy(cfg, {
          set: function (target, option) {
            throw new Error('Cannot set SystemJS.' + configName + '["' + option + '"] directly. Use SystemJS.config({ ' + configName + ': { "' + option + '": ... } }) rather.');
          }
        });

      //if (typeof cfg === 'object')
      //  warn.call(this[CONFIG], 'Referencing `SystemJS.' + configName + '` is deprecated. Use the config getter `SystemJS.getConfig(\'' + configName + '\')`');
      return cfg;
    },
    set: function (name) {
      throw new Error('Setting `SystemJS.' + configName + '` directly is no longer supported. Use `SystemJS.config({ ' + configName + ': ... })`.');
    }
  });
})(configNames[i]);

/*
 * Backwards-compatible registry API, to be deprecated
 */
function registryWarn(loader, method) {
  warn.call(loader[CONFIG], 'SystemJS.' + method + ' is deprecated for SystemJS.registry.' + method);
}
SystemJSLoader$1.prototype.delete = function (key) {
  registryWarn(this, 'delete');
  this.registry.delete(key);
};
SystemJSLoader$1.prototype.get = function (key) {
  registryWarn(this, 'get');
  return this.registry.get(key);
};
SystemJSLoader$1.prototype.has = function (key) {
  registryWarn(this, 'has');
  return this.registry.has(key);
};
SystemJSLoader$1.prototype.set = function (key, module) {
  registryWarn(this, 'set');
  return this.registry.set(key, module);
};
SystemJSLoader$1.prototype.newModule = function (bindings) {
  return new ModuleNamespace(bindings);
};
SystemJSLoader$1.prototype.isModule = isModule;

// ensure System.register and System.registerDynamic decanonicalize
SystemJSLoader$1.prototype.register = function (key, deps, declare) {
  if (typeof key === 'string')
    key = decanonicalize.call(this, this[CONFIG], key);
  return RegisterLoader$1.prototype.register.call(this, key, deps, declare);
};

SystemJSLoader$1.prototype.registerDynamic = function (key, deps, executingRequire, execute) {
  if (typeof key === 'string')
    key = decanonicalize.call(this, this[CONFIG], key);
  return RegisterLoader$1.prototype.registerDynamic.call(this, key, deps, executingRequire, execute);
};

SystemJSLoader$1.prototype.version = "0.20.12 Dev";

var System = new SystemJSLoader$1();

// only set the global System on the global in browsers
if (isBrowser || isWorker)
  envGlobal.SystemJS = envGlobal.System = System;

if (typeof module !== 'undefined' && module.exports)
  module.exports = System;

}());
//# sourceMappingURL=system.src.js.map

System.config({
    map: {
        "put-selector": "node_modules/put-selector/put.js",
        "showdown": "node_modules/showdown/dist/showdown.js"
    }
});

// Copyright (C) 2006 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


/**
 * @fileoverview
 * some functions for browser-side pretty printing of code contained in html.
 *
 * <p>
 * For a fairly comprehensive set of languages see the
 * <a href="http://google-code-prettify.googlecode.com/svn/trunk/README.html#langs">README</a>
 * file that came with this source.  At a minimum, the lexer should work on a
 * number of languages including C and friends, Java, Python, Bash, SQL, HTML,
 * XML, CSS, Javascript, and Makefiles.  It works passably on Ruby, PHP and Awk
 * and a subset of Perl, but, because of commenting conventions, doesn't work on
 * Smalltalk, Lisp-like, or CAML-like languages without an explicit lang class.
 * <p>
 * Usage: <ol>
 * <li> include this source file in an html page via
 *   {@code <script type="text/javascript" src="/path/to/prettify.js"></script>}
 * <li> define style rules.  See the example page for examples.
 * <li> mark the {@code <pre>} and {@code <code>} tags in your source with
 *    {@code class=prettyprint.}
 *    You can also use the (html deprecated) {@code <xmp>} tag, but the pretty
 *    printer needs to do more substantial DOM manipulations to support that, so
 *    some css styles may not be preserved.
 * </ol>
 * That's it.  I wanted to keep the API as simple as possible, so there's no
 * need to specify which language the code is in, but if you wish, you can add
 * another class to the {@code <pre>} or {@code <code>} element to specify the
 * language, as in {@code <pre class="prettyprint lang-java">}.  Any class that
 * starts with "lang-" followed by a file extension, specifies the file type.
 * See the "lang-*.js" files in this directory for code that implements
 * per-language file handlers.
 * <p>
 * Change log:<br>
 * cbeust, 2006/08/22
 * <blockquote>
 *   Java annotations (start with "@") are now captured as literals ("lit")
 * </blockquote>
 * @requires console
 */

// JSLint declarations
/*global console, document, navigator, setTimeout, window, define */

/** @define {boolean} */
var IN_GLOBAL_SCOPE = true;

/**
 * Split {@code prettyPrint} into multiple timeouts so as not to interfere with
 * UI events.
 * If set to {@code false}, {@code prettyPrint()} is synchronous.
 */
window['PR_SHOULD_USE_CONTINUATION'] = true;

/**
 * Pretty print a chunk of code.
 * @param {string} sourceCodeHtml The HTML to pretty print.
 * @param {string} opt_langExtension The language name to use.
 *     Typically, a filename extension like 'cpp' or 'java'.
 * @param {number|boolean} opt_numberLines True to number lines,
 *     or the 1-indexed number of the first line in sourceCodeHtml.
 * @return {string} code as html, but prettier
 */
var prettyPrintOne;
/**
 * Find all the {@code <pre>} and {@code <code>} tags in the DOM with
 * {@code class=prettyprint} and prettify them.
 *
 * @param {Function} opt_whenDone called when prettifying is done.
 * @param {HTMLElement|HTMLDocument} opt_root an element or document
 *   containing all the elements to pretty print.
 *   Defaults to {@code document.body}.
 */
var prettyPrint;


(function () {
  var win = window;
  // Keyword lists for various languages.
  // We use things that coerce to strings to make them compact when minified
  // and to defeat aggressive optimizers that fold large string constants.
  var FLOW_CONTROL_KEYWORDS = ["break,continue,do,else,for,if,return,while"];
  var C_KEYWORDS = [FLOW_CONTROL_KEYWORDS,"auto,case,char,const,default," + 
      "double,enum,extern,float,goto,inline,int,long,register,short,signed," +
      "sizeof,static,struct,switch,typedef,union,unsigned,void,volatile"];
  var COMMON_KEYWORDS = [C_KEYWORDS,"catch,class,delete,false,import," +
      "new,operator,private,protected,public,this,throw,true,try,typeof"];
  var CPP_KEYWORDS = [COMMON_KEYWORDS,"alignof,align_union,asm,axiom,bool," +
      "concept,concept_map,const_cast,constexpr,decltype,delegate," +
      "dynamic_cast,explicit,export,friend,generic,late_check," +
      "mutable,namespace,nullptr,property,reinterpret_cast,static_assert," +
      "static_cast,template,typeid,typename,using,virtual,where"];
  var JAVA_KEYWORDS = [COMMON_KEYWORDS,
      "abstract,assert,boolean,byte,extends,final,finally,implements,import," +
      "instanceof,interface,null,native,package,strictfp,super,synchronized," +
      "throws,transient"];
  var CSHARP_KEYWORDS = [JAVA_KEYWORDS,
      "as,base,by,checked,decimal,delegate,descending,dynamic,event," +
      "fixed,foreach,from,group,implicit,in,internal,into,is,let," +
      "lock,object,out,override,orderby,params,partial,readonly,ref,sbyte," +
      "sealed,stackalloc,string,select,uint,ulong,unchecked,unsafe,ushort," +
      "var,virtual,where"];
  var COFFEE_KEYWORDS = "all,and,by,catch,class,else,extends,false,finally," +
      "for,if,in,is,isnt,loop,new,no,not,null,of,off,on,or,return,super,then," +
      "throw,true,try,unless,until,when,while,yes";
  var JSCRIPT_KEYWORDS = [COMMON_KEYWORDS,
      "debugger,eval,export,function,get,null,set,undefined,var,with," +
      "Infinity,NaN"];
  var PERL_KEYWORDS = "caller,delete,die,do,dump,elsif,eval,exit,foreach,for," +
      "goto,if,import,last,local,my,next,no,our,print,package,redo,require," +
      "sub,undef,unless,until,use,wantarray,while,BEGIN,END";
  var PYTHON_KEYWORDS = [FLOW_CONTROL_KEYWORDS, "and,as,assert,class,def,del," +
      "elif,except,exec,finally,from,global,import,in,is,lambda," +
      "nonlocal,not,or,pass,print,raise,try,with,yield," +
      "False,True,None"];
  var RUBY_KEYWORDS = [FLOW_CONTROL_KEYWORDS, "alias,and,begin,case,class," +
      "def,defined,elsif,end,ensure,false,in,module,next,nil,not,or,redo," +
      "rescue,retry,self,super,then,true,undef,unless,until,when,yield," +
      "BEGIN,END"];
   var RUST_KEYWORDS = [FLOW_CONTROL_KEYWORDS, "as,assert,const,copy,drop," +
      "enum,extern,fail,false,fn,impl,let,log,loop,match,mod,move,mut,priv," +
      "pub,pure,ref,self,static,struct,true,trait,type,unsafe,use"];
  var SH_KEYWORDS = [FLOW_CONTROL_KEYWORDS, "case,done,elif,esac,eval,fi," +
      "function,in,local,set,then,until"];
  var ALL_KEYWORDS = [
      CPP_KEYWORDS, CSHARP_KEYWORDS, JSCRIPT_KEYWORDS, PERL_KEYWORDS,
      PYTHON_KEYWORDS, RUBY_KEYWORDS, SH_KEYWORDS];
  var C_TYPES = /^(DIR|FILE|vector|(de|priority_)?queue|list|stack|(const_)?iterator|(multi)?(set|map)|bitset|u?(int|float)\d*)\b/;

  // token style names.  correspond to css classes
  /**
   * token style for a string literal
   * @const
   */
  var PR_STRING = 'str';
  /**
   * token style for a keyword
   * @const
   */
  var PR_KEYWORD = 'kwd';
  /**
   * token style for a comment
   * @const
   */
  var PR_COMMENT = 'com';
  /**
   * token style for a type
   * @const
   */
  var PR_TYPE = 'typ';
  /**
   * token style for a literal value.  e.g. 1, null, true.
   * @const
   */
  var PR_LITERAL = 'lit';
  /**
   * token style for a punctuation string.
   * @const
   */
  var PR_PUNCTUATION = 'pun';
  /**
   * token style for plain text.
   * @const
   */
  var PR_PLAIN = 'pln';

  /**
   * token style for an sgml tag.
   * @const
   */
  var PR_TAG = 'tag';
  /**
   * token style for a markup declaration such as a DOCTYPE.
   * @const
   */
  var PR_DECLARATION = 'dec';
  /**
   * token style for embedded source.
   * @const
   */
  var PR_SOURCE = 'src';
  /**
   * token style for an sgml attribute name.
   * @const
   */
  var PR_ATTRIB_NAME = 'atn';
  /**
   * token style for an sgml attribute value.
   * @const
   */
  var PR_ATTRIB_VALUE = 'atv';

  /**
   * A class that indicates a section of markup that is not code, e.g. to allow
   * embedding of line numbers within code listings.
   * @const
   */
  var PR_NOCODE = 'nocode';

  
  
  /**
   * A set of tokens that can precede a regular expression literal in
   * javascript
   * http://web.archive.org/web/20070717142515/http://www.mozilla.org/js/language/js20/rationale/syntax.html
   * has the full list, but I've removed ones that might be problematic when
   * seen in languages that don't support regular expression literals.
   *
   * <p>Specifically, I've removed any keywords that can't precede a regexp
   * literal in a syntactically legal javascript program, and I've removed the
   * "in" keyword since it's not a keyword in many languages, and might be used
   * as a count of inches.
   *
   * <p>The link above does not accurately describe EcmaScript rules since
   * it fails to distinguish between (a=++/b/i) and (a++/b/i) but it works
   * very well in practice.
   *
   * @private
   * @const
   */
  var REGEXP_PRECEDER_PATTERN = '(?:^^\\.?|[+-]|[!=]=?=?|\\#|%=?|&&?=?|\\(|\\*=?|[+\\-]=|->|\\/=?|::?|<<?=?|>>?>?=?|,|;|\\?|@|\\[|~|{|\\^\\^?=?|\\|\\|?=?|break|case|continue|delete|do|else|finally|instanceof|return|throw|try|typeof)\\s*';
  
  // CAVEAT: this does not properly handle the case where a regular
  // expression immediately follows another since a regular expression may
  // have flags for case-sensitivity and the like.  Having regexp tokens
  // adjacent is not valid in any language I'm aware of, so I'm punting.
  // TODO: maybe style special characters inside a regexp as punctuation.

  /**
   * Given a group of {@link RegExp}s, returns a {@code RegExp} that globally
   * matches the union of the sets of strings matched by the input RegExp.
   * Since it matches globally, if the input strings have a start-of-input
   * anchor (/^.../), it is ignored for the purposes of unioning.
   * @param {Array.<RegExp>} regexs non multiline, non-global regexs.
   * @return {RegExp} a global regex.
   */
  function combinePrefixPatterns(regexs) {
    var capturedGroupIndex = 0;
  
    var needToFoldCase = false;
    var ignoreCase = false;
    for (var i = 0, n = regexs.length; i < n; ++i) {
      var regex = regexs[i];
      if (regex.ignoreCase) {
        ignoreCase = true;
      } else if (/[a-z]/i.test(regex.source.replace(
                     /\\u[0-9a-f]{4}|\\x[0-9a-f]{2}|\\[^ux]/gi, ''))) {
        needToFoldCase = true;
        ignoreCase = false;
        break;
      }
    }
  
    var escapeCharToCodeUnit = {
      'b': 8,
      't': 9,
      'n': 0xa,
      'v': 0xb,
      'f': 0xc,
      'r': 0xd
    };
  
    function decodeEscape(charsetPart) {
      var cc0 = charsetPart.charCodeAt(0);
      if (cc0 !== 92 /* \\ */) {
        return cc0;
      }
      var c1 = charsetPart.charAt(1);
      cc0 = escapeCharToCodeUnit[c1];
      if (cc0) {
        return cc0;
      } else if ('0' <= c1 && c1 <= '7') {
        return parseInt(charsetPart.substring(1), 8);
      } else if (c1 === 'u' || c1 === 'x') {
        return parseInt(charsetPart.substring(2), 16);
      } else {
        return charsetPart.charCodeAt(1);
      }
    }
  
    function encodeEscape(charCode) {
      if (charCode < 0x20) {
        return (charCode < 0x10 ? '\\x0' : '\\x') + charCode.toString(16);
      }
      var ch = String.fromCharCode(charCode);
      return (ch === '\\' || ch === '-' || ch === ']' || ch === '^')
          ? "\\" + ch : ch;
    }
  
    function caseFoldCharset(charSet) {
      var charsetParts = charSet.substring(1, charSet.length - 1).match(
          new RegExp(
              '\\\\u[0-9A-Fa-f]{4}'
              + '|\\\\x[0-9A-Fa-f]{2}'
              + '|\\\\[0-3][0-7]{0,2}'
              + '|\\\\[0-7]{1,2}'
              + '|\\\\[\\s\\S]'
              + '|-'
              + '|[^-\\\\]',
              'g'));
      var ranges = [];
      var inverse = charsetParts[0] === '^';
  
      var out = ['['];
      if (inverse) { out.push('^'); }
  
      for (var i = inverse ? 1 : 0, n = charsetParts.length; i < n; ++i) {
        var p = charsetParts[i];
        if (/\\[bdsw]/i.test(p)) {  // Don't muck with named groups.
          out.push(p);
        } else {
          var start = decodeEscape(p);
          var end;
          if (i + 2 < n && '-' === charsetParts[i + 1]) {
            end = decodeEscape(charsetParts[i + 2]);
            i += 2;
          } else {
            end = start;
          }
          ranges.push([start, end]);
          // If the range might intersect letters, then expand it.
          // This case handling is too simplistic.
          // It does not deal with non-latin case folding.
          // It works for latin source code identifiers though.
          if (!(end < 65 || start > 122)) {
            if (!(end < 65 || start > 90)) {
              ranges.push([Math.max(65, start) | 32, Math.min(end, 90) | 32]);
            }
            if (!(end < 97 || start > 122)) {
              ranges.push([Math.max(97, start) & ~32, Math.min(end, 122) & ~32]);
            }
          }
        }
      }
  
      // [[1, 10], [3, 4], [8, 12], [14, 14], [16, 16], [17, 17]]
      // -> [[1, 12], [14, 14], [16, 17]]
      ranges.sort(function (a, b) { return (a[0] - b[0]) || (b[1]  - a[1]); });
      var consolidatedRanges = [];
      var lastRange = [];
      for (var i = 0; i < ranges.length; ++i) {
        var range = ranges[i];
        if (range[0] <= lastRange[1] + 1) {
          lastRange[1] = Math.max(lastRange[1], range[1]);
        } else {
          consolidatedRanges.push(lastRange = range);
        }
      }
  
      for (var i = 0; i < consolidatedRanges.length; ++i) {
        var range = consolidatedRanges[i];
        out.push(encodeEscape(range[0]));
        if (range[1] > range[0]) {
          if (range[1] + 1 > range[0]) { out.push('-'); }
          out.push(encodeEscape(range[1]));
        }
      }
      out.push(']');
      return out.join('');
    }
  
    function allowAnywhereFoldCaseAndRenumberGroups(regex) {
      // Split into character sets, escape sequences, punctuation strings
      // like ('(', '(?:', ')', '^'), and runs of characters that do not
      // include any of the above.
      var parts = regex.source.match(
          new RegExp(
              '(?:'
              + '\\[(?:[^\\x5C\\x5D]|\\\\[\\s\\S])*\\]'  // a character set
              + '|\\\\u[A-Fa-f0-9]{4}'  // a unicode escape
              + '|\\\\x[A-Fa-f0-9]{2}'  // a hex escape
              + '|\\\\[0-9]+'  // a back-reference or octal escape
              + '|\\\\[^ux0-9]'  // other escape sequence
              + '|\\(\\?[:!=]'  // start of a non-capturing group
              + '|[\\(\\)\\^]'  // start/end of a group, or line start
              + '|[^\\x5B\\x5C\\(\\)\\^]+'  // run of other characters
              + ')',
              'g'));
      var n = parts.length;
  
      // Maps captured group numbers to the number they will occupy in
      // the output or to -1 if that has not been determined, or to
      // undefined if they need not be capturing in the output.
      var capturedGroups = [];
  
      // Walk over and identify back references to build the capturedGroups
      // mapping.
      for (var i = 0, groupIndex = 0; i < n; ++i) {
        var p = parts[i];
        if (p === '(') {
          // groups are 1-indexed, so max group index is count of '('
          ++groupIndex;
        } else if ('\\' === p.charAt(0)) {
          var decimalValue = +p.substring(1);
          if (decimalValue) {
            if (decimalValue <= groupIndex) {
              capturedGroups[decimalValue] = -1;
            } else {
              // Replace with an unambiguous escape sequence so that
              // an octal escape sequence does not turn into a backreference
              // to a capturing group from an earlier regex.
              parts[i] = encodeEscape(decimalValue);
            }
          }
        }
      }
  
      // Renumber groups and reduce capturing groups to non-capturing groups
      // where possible.
      for (var i = 1; i < capturedGroups.length; ++i) {
        if (-1 === capturedGroups[i]) {
          capturedGroups[i] = ++capturedGroupIndex;
        }
      }
      for (var i = 0, groupIndex = 0; i < n; ++i) {
        var p = parts[i];
        if (p === '(') {
          ++groupIndex;
          if (!capturedGroups[groupIndex]) {
            parts[i] = '(?:';
          }
        } else if ('\\' === p.charAt(0)) {
          var decimalValue = +p.substring(1);
          if (decimalValue && decimalValue <= groupIndex) {
            parts[i] = '\\' + capturedGroups[decimalValue];
          }
        }
      }
  
      // Remove any prefix anchors so that the output will match anywhere.
      // ^^ really does mean an anchored match though.
      for (var i = 0; i < n; ++i) {
        if ('^' === parts[i] && '^' !== parts[i + 1]) { parts[i] = ''; }
      }
  
      // Expand letters to groups to handle mixing of case-sensitive and
      // case-insensitive patterns if necessary.
      if (regex.ignoreCase && needToFoldCase) {
        for (var i = 0; i < n; ++i) {
          var p = parts[i];
          var ch0 = p.charAt(0);
          if (p.length >= 2 && ch0 === '[') {
            parts[i] = caseFoldCharset(p);
          } else if (ch0 !== '\\') {
            // TODO: handle letters in numeric escapes.
            parts[i] = p.replace(
                /[a-zA-Z]/g,
                function (ch) {
                  var cc = ch.charCodeAt(0);
                  return '[' + String.fromCharCode(cc & ~32, cc | 32) + ']';
                });
          }
        }
      }
  
      return parts.join('');
    }
  
    var rewritten = [];
    for (var i = 0, n = regexs.length; i < n; ++i) {
      var regex = regexs[i];
      if (regex.global || regex.multiline) { throw new Error('' + regex); }
      rewritten.push(
          '(?:' + allowAnywhereFoldCaseAndRenumberGroups(regex) + ')');
    }
  
    return new RegExp(rewritten.join('|'), ignoreCase ? 'gi' : 'g');
  }

  /**
   * Split markup into a string of source code and an array mapping ranges in
   * that string to the text nodes in which they appear.
   *
   * <p>
   * The HTML DOM structure:</p>
   * <pre>
   * (Element   "p"
   *   (Element "b"
   *     (Text  "print "))       ; #1
   *   (Text    "'Hello '")      ; #2
   *   (Element "br")            ; #3
   *   (Text    "  + 'World';")) ; #4
   * </pre>
   * <p>
   * corresponds to the HTML
   * {@code <p><b>print </b>'Hello '<br>  + 'World';</p>}.</p>
   *
   * <p>
   * It will produce the output:</p>
   * <pre>
   * {
   *   sourceCode: "print 'Hello '\n  + 'World';",
   *   //                     1          2
   *   //           012345678901234 5678901234567
   *   spans: [0, #1, 6, #2, 14, #3, 15, #4]
   * }
   * </pre>
   * <p>
   * where #1 is a reference to the {@code "print "} text node above, and so
   * on for the other text nodes.
   * </p>
   *
   * <p>
   * The {@code} spans array is an array of pairs.  Even elements are the start
   * indices of substrings, and odd elements are the text nodes (or BR elements)
   * that contain the text for those substrings.
   * Substrings continue until the next index or the end of the source.
   * </p>
   *
   * @param {Node} node an HTML DOM subtree containing source-code.
   * @param {boolean} isPreformatted true if white-space in text nodes should
   *    be considered significant.
   * @return {Object} source code and the text nodes in which they occur.
   */
  function extractSourceSpans(node, isPreformatted) {
    var nocode = /(?:^|\s)nocode(?:\s|$)/;
  
    var chunks = [];
    var length = 0;
    var spans = [];
    var k = 0;
  
    function walk(node) {
      var type = node.nodeType;
      if (type == 1) {  // Element
        if (nocode.test(node.className)) { return; }
        for (var child = node.firstChild; child; child = child.nextSibling) {
          walk(child);
        }
        var nodeName = node.nodeName.toLowerCase();
        if ('br' === nodeName || 'li' === nodeName) {
          chunks[k] = '\n';
          spans[k << 1] = length++;
          spans[(k++ << 1) | 1] = node;
        }
      } else if (type == 3 || type == 4) {  // Text
        var text = node.nodeValue;
        if (text.length) {
          if (!isPreformatted) {
            text = text.replace(/[ \t\r\n]+/g, ' ');
          } else {
            text = text.replace(/\r\n?/g, '\n');  // Normalize newlines.
          }
          // TODO: handle tabs here?
          chunks[k] = text;
          spans[k << 1] = length;
          length += text.length;
          spans[(k++ << 1) | 1] = node;
        }
      }
    }
  
    walk(node);
  
    return {
      sourceCode: chunks.join('').replace(/\n$/, ''),
      spans: spans
    };
  }

  /**
   * Apply the given language handler to sourceCode and add the resulting
   * decorations to out.
   * @param {number} basePos the index of sourceCode within the chunk of source
   *    whose decorations are already present on out.
   */
  function appendDecorations(basePos, sourceCode, langHandler, out) {
    if (!sourceCode) { return; }
    var job = {
      sourceCode: sourceCode,
      basePos: basePos
    };
    langHandler(job);
    out.push.apply(out, job.decorations);
  }

  var notWs = /\S/;

  /**
   * Given an element, if it contains only one child element and any text nodes
   * it contains contain only space characters, return the sole child element.
   * Otherwise returns undefined.
   * <p>
   * This is meant to return the CODE element in {@code <pre><code ...>} when
   * there is a single child element that contains all the non-space textual
   * content, but not to return anything where there are multiple child elements
   * as in {@code <pre><code>...</code><code>...</code></pre>} or when there
   * is textual content.
   */
  function childContentWrapper(element) {
    var wrapper = undefined;
    for (var c = element.firstChild; c; c = c.nextSibling) {
      var type = c.nodeType;
      wrapper = (type === 1)  // Element Node
          ? (wrapper ? element : c)
          : (type === 3)  // Text Node
          ? (notWs.test(c.nodeValue) ? element : wrapper)
          : wrapper;
    }
    return wrapper === element ? undefined : wrapper;
  }

  /** Given triples of [style, pattern, context] returns a lexing function,
    * The lexing function interprets the patterns to find token boundaries and
    * returns a decoration list of the form
    * [index_0, style_0, index_1, style_1, ..., index_n, style_n]
    * where index_n is an index into the sourceCode, and style_n is a style
    * constant like PR_PLAIN.  index_n-1 <= index_n, and style_n-1 applies to
    * all characters in sourceCode[index_n-1:index_n].
    *
    * The stylePatterns is a list whose elements have the form
    * [style : string, pattern : RegExp, DEPRECATED, shortcut : string].
    *
    * Style is a style constant like PR_PLAIN, or can be a string of the
    * form 'lang-FOO', where FOO is a language extension describing the
    * language of the portion of the token in $1 after pattern executes.
    * E.g., if style is 'lang-lisp', and group 1 contains the text
    * '(hello (world))', then that portion of the token will be passed to the
    * registered lisp handler for formatting.
    * The text before and after group 1 will be restyled using this decorator
    * so decorators should take care that this doesn't result in infinite
    * recursion.  For example, the HTML lexer rule for SCRIPT elements looks
    * something like ['lang-js', /<[s]cript>(.+?)<\/script>/].  This may match
    * '<script>foo()<\/script>', which would cause the current decorator to
    * be called with '<script>' which would not match the same rule since
    * group 1 must not be empty, so it would be instead styled as PR_TAG by
    * the generic tag rule.  The handler registered for the 'js' extension would
    * then be called with 'foo()', and finally, the current decorator would
    * be called with '<\/script>' which would not match the original rule and
    * so the generic tag rule would identify it as a tag.
    *
    * Pattern must only match prefixes, and if it matches a prefix, then that
    * match is considered a token with the same style.
    *
    * Context is applied to the last non-whitespace, non-comment token
    * recognized.
    *
    * Shortcut is an optional string of characters, any of which, if the first
    * character, gurantee that this pattern and only this pattern matches.
    *
    * @param {Array} shortcutStylePatterns patterns that always start with
    *   a known character.  Must have a shortcut string.
    * @param {Array} fallthroughStylePatterns patterns that will be tried in
    *   order if the shortcut ones fail.  May have shortcuts.
    *
    * @return {function (Object)} a
    *   function that takes source code and returns a list of decorations.
    */
  function createSimpleLexer(shortcutStylePatterns, fallthroughStylePatterns) {
    var shortcuts = {};
    var tokenizer;
    (function () {
      var allPatterns = shortcutStylePatterns.concat(fallthroughStylePatterns);
      var allRegexs = [];
      var regexKeys = {};
      for (var i = 0, n = allPatterns.length; i < n; ++i) {
        var patternParts = allPatterns[i];
        var shortcutChars = patternParts[3];
        if (shortcutChars) {
          for (var c = shortcutChars.length; --c >= 0;) {
            shortcuts[shortcutChars.charAt(c)] = patternParts;
          }
        }
        var regex = patternParts[1];
        var k = '' + regex;
        if (!regexKeys.hasOwnProperty(k)) {
          allRegexs.push(regex);
          regexKeys[k] = null;
        }
      }
      allRegexs.push(/[\0-\uffff]/);
      tokenizer = combinePrefixPatterns(allRegexs);
    })();

    var nPatterns = fallthroughStylePatterns.length;

    /**
     * Lexes job.sourceCode and produces an output array job.decorations of
     * style classes preceded by the position at which they start in
     * job.sourceCode in order.
     *
     * @param {Object} job an object like <pre>{
     *    sourceCode: {string} sourceText plain text,
     *    basePos: {int} position of job.sourceCode in the larger chunk of
     *        sourceCode.
     * }</pre>
     */
    var decorate = function (job) {
      var sourceCode = job.sourceCode, basePos = job.basePos;
      /** Even entries are positions in source in ascending order.  Odd enties
        * are style markers (e.g., PR_COMMENT) that run from that position until
        * the end.
        * @type {Array.<number|string>}
        */
      var decorations = [basePos, PR_PLAIN];
      var pos = 0;  // index into sourceCode
      var tokens = sourceCode.match(tokenizer) || [];
      var styleCache = {};

      for (var ti = 0, nTokens = tokens.length; ti < nTokens; ++ti) {
        var token = tokens[ti];
        var style = styleCache[token];
        var match = void 0;

        var isEmbedded;
        if (typeof style === 'string') {
          isEmbedded = false;
        } else {
          var patternParts = shortcuts[token.charAt(0)];
          if (patternParts) {
            match = token.match(patternParts[1]);
            style = patternParts[0];
          } else {
            for (var i = 0; i < nPatterns; ++i) {
              patternParts = fallthroughStylePatterns[i];
              match = token.match(patternParts[1]);
              if (match) {
                style = patternParts[0];
                break;
              }
            }

            if (!match) {  // make sure that we make progress
              style = PR_PLAIN;
            }
          }

          isEmbedded = style.length >= 5 && 'lang-' === style.substring(0, 5);
          if (isEmbedded && !(match && typeof match[1] === 'string')) {
            isEmbedded = false;
            style = PR_SOURCE;
          }

          if (!isEmbedded) { styleCache[token] = style; }
        }

        var tokenStart = pos;
        pos += token.length;

        if (!isEmbedded) {
          decorations.push(basePos + tokenStart, style);
        } else {  // Treat group 1 as an embedded block of source code.
          var embeddedSource = match[1];
          var embeddedSourceStart = token.indexOf(embeddedSource);
          var embeddedSourceEnd = embeddedSourceStart + embeddedSource.length;
          if (match[2]) {
            // If embeddedSource can be blank, then it would match at the
            // beginning which would cause us to infinitely recurse on the
            // entire token, so we catch the right context in match[2].
            embeddedSourceEnd = token.length - match[2].length;
            embeddedSourceStart = embeddedSourceEnd - embeddedSource.length;
          }
          var lang = style.substring(5);
          // Decorate the left of the embedded source
          appendDecorations(
              basePos + tokenStart,
              token.substring(0, embeddedSourceStart),
              decorate, decorations);
          // Decorate the embedded source
          appendDecorations(
              basePos + tokenStart + embeddedSourceStart,
              embeddedSource,
              langHandlerForExtension(lang, embeddedSource),
              decorations);
          // Decorate the right of the embedded section
          appendDecorations(
              basePos + tokenStart + embeddedSourceEnd,
              token.substring(embeddedSourceEnd),
              decorate, decorations);
        }
      }
      job.decorations = decorations;
    };
    return decorate;
  }

  /** returns a function that produces a list of decorations from source text.
    *
    * This code treats ", ', and ` as string delimiters, and \ as a string
    * escape.  It does not recognize perl's qq() style strings.
    * It has no special handling for double delimiter escapes as in basic, or
    * the tripled delimiters used in python, but should work on those regardless
    * although in those cases a single string literal may be broken up into
    * multiple adjacent string literals.
    *
    * It recognizes C, C++, and shell style comments.
    *
    * @param {Object} options a set of optional parameters.
    * @return {function (Object)} a function that examines the source code
    *     in the input job and builds the decoration list.
    */
  function sourceDecorator(options) {
    var shortcutStylePatterns = [], fallthroughStylePatterns = [];
    if (options['tripleQuotedStrings']) {
      // '''multi-line-string''', 'single-line-string', and double-quoted
      shortcutStylePatterns.push(
          [PR_STRING,  /^(?:\'\'\'(?:[^\'\\]|\\[\s\S]|\'{1,2}(?=[^\']))*(?:\'\'\'|$)|\"\"\"(?:[^\"\\]|\\[\s\S]|\"{1,2}(?=[^\"]))*(?:\"\"\"|$)|\'(?:[^\\\']|\\[\s\S])*(?:\'|$)|\"(?:[^\\\"]|\\[\s\S])*(?:\"|$))/,
           null, '\'"']);
    } else if (options['multiLineStrings']) {
      // 'multi-line-string', "multi-line-string"
      shortcutStylePatterns.push(
          [PR_STRING,  /^(?:\'(?:[^\\\']|\\[\s\S])*(?:\'|$)|\"(?:[^\\\"]|\\[\s\S])*(?:\"|$)|\`(?:[^\\\`]|\\[\s\S])*(?:\`|$))/,
           null, '\'"`']);
    } else {
      // 'single-line-string', "single-line-string"
      shortcutStylePatterns.push(
          [PR_STRING,
           /^(?:\'(?:[^\\\'\r\n]|\\.)*(?:\'|$)|\"(?:[^\\\"\r\n]|\\.)*(?:\"|$))/,
           null, '"\'']);
    }
    if (options['verbatimStrings']) {
      // verbatim-string-literal production from the C# grammar.  See issue 93.
      fallthroughStylePatterns.push(
          [PR_STRING, /^@\"(?:[^\"]|\"\")*(?:\"|$)/, null]);
    }
    var hc = options['hashComments'];
    if (hc) {
      if (options['cStyleComments']) {
        if (hc > 1) {  // multiline hash comments
          shortcutStylePatterns.push(
              [PR_COMMENT, /^#(?:##(?:[^#]|#(?!##))*(?:###|$)|.*)/, null, '#']);
        } else {
          // Stop C preprocessor declarations at an unclosed open comment
          shortcutStylePatterns.push(
              [PR_COMMENT, /^#(?:(?:define|e(?:l|nd)if|else|error|ifn?def|include|line|pragma|undef|warning)\b|[^\r\n]*)/,
               null, '#']);
        }
        // #include <stdio.h>
        fallthroughStylePatterns.push(
            [PR_STRING,
             /^<(?:(?:(?:\.\.\/)*|\/?)(?:[\w-]+(?:\/[\w-]+)+)?[\w-]+\.h(?:h|pp|\+\+)?|[a-z]\w*)>/,
             null]);
      } else {
        shortcutStylePatterns.push([PR_COMMENT, /^#[^\r\n]*/, null, '#']);
      }
    }
    if (options['cStyleComments']) {
      fallthroughStylePatterns.push([PR_COMMENT, /^\/\/[^\r\n]*/, null]);
      fallthroughStylePatterns.push(
          [PR_COMMENT, /^\/\*[\s\S]*?(?:\*\/|$)/, null]);
    }
    var regexLiterals = options['regexLiterals'];
    if (regexLiterals) {
      /**
       * @const
       */
      var regexExcls = regexLiterals > 1
        ? ''  // Multiline regex literals
        : '\n\r';
      /**
       * @const
       */
      var regexAny = regexExcls ? '.' : '[\\S\\s]';
      /**
       * @const
       */
      var REGEX_LITERAL = (
          // A regular expression literal starts with a slash that is
          // not followed by * or / so that it is not confused with
          // comments.
          '/(?=[^/*' + regexExcls + '])'
          // and then contains any number of raw characters,
          + '(?:[^/\\x5B\\x5C' + regexExcls + ']'
          // escape sequences (\x5C),
          +    '|\\x5C' + regexAny
          // or non-nesting character sets (\x5B\x5D);
          +    '|\\x5B(?:[^\\x5C\\x5D' + regexExcls + ']'
          +             '|\\x5C' + regexAny + ')*(?:\\x5D|$))+'
          // finally closed by a /.
          + '/');
      fallthroughStylePatterns.push(
          ['lang-regex',
           RegExp('^' + REGEXP_PRECEDER_PATTERN + '(' + REGEX_LITERAL + ')')
           ]);
    }

    var types = options['types'];
    if (types) {
      fallthroughStylePatterns.push([PR_TYPE, types]);
    }

    var keywords = ("" + options['keywords']).replace(/^ | $/g, '');
    if (keywords.length) {
      fallthroughStylePatterns.push(
          [PR_KEYWORD,
           new RegExp('^(?:' + keywords.replace(/[\s,]+/g, '|') + ')\\b'),
           null]);
    }

    shortcutStylePatterns.push([PR_PLAIN,       /^\s+/, null, ' \r\n\t\xA0']);

    var punctuation =
      // The Bash man page says

      // A word is a sequence of characters considered as a single
      // unit by GRUB. Words are separated by metacharacters,
      // which are the following plus space, tab, and newline: { }
      // | & $ ; < >
      // ...
      
      // A word beginning with # causes that word and all remaining
      // characters on that line to be ignored.

      // which means that only a '#' after /(?:^|[{}|&$;<>\s])/ starts a
      // comment but empirically
      // $ echo {#}
      // {#}
      // $ echo \$#
      // $#
      // $ echo }#
      // }#

      // so /(?:^|[|&;<>\s])/ is more appropriate.

      // http://gcc.gnu.org/onlinedocs/gcc-2.95.3/cpp_1.html#SEC3
      // suggests that this definition is compatible with a
      // default mode that tries to use a single token definition
      // to recognize both bash/python style comments and C
      // preprocessor directives.

      // This definition of punctuation does not include # in the list of
      // follow-on exclusions, so # will not be broken before if preceeded
      // by a punctuation character.  We could try to exclude # after
      // [|&;<>] but that doesn't seem to cause many major problems.
      // If that does turn out to be a problem, we should change the below
      // when hc is truthy to include # in the run of punctuation characters
      // only when not followint [|&;<>].
      '^.[^\\s\\w.$@\'"`/\\\\]*';
    if (options['regexLiterals']) {
      punctuation += '(?!\s*\/)';
    }

    fallthroughStylePatterns.push(
        // TODO(mikesamuel): recognize non-latin letters and numerals in idents
        [PR_LITERAL,     /^@[a-z_$][a-z_$@0-9]*/i, null],
        [PR_TYPE,        /^(?:[@_]?[A-Z]+[a-z][A-Za-z_$@0-9]*|\w+_t\b)/, null],
        [PR_PLAIN,       /^[a-z_$][a-z_$@0-9]*/i, null],
        [PR_LITERAL,
         new RegExp(
             '^(?:'
             // A hex number
             + '0x[a-f0-9]+'
             // or an octal or decimal number,
             + '|(?:\\d(?:_\\d+)*\\d*(?:\\.\\d*)?|\\.\\d\\+)'
             // possibly in scientific notation
             + '(?:e[+\\-]?\\d+)?'
             + ')'
             // with an optional modifier like UL for unsigned long
             + '[a-z]*', 'i'),
         null, '0123456789'],
        // Don't treat escaped quotes in bash as starting strings.
        // See issue 144.
        [PR_PLAIN,       /^\\[\s\S]?/, null],
        [PR_PUNCTUATION, new RegExp(punctuation), null]);

    return createSimpleLexer(shortcutStylePatterns, fallthroughStylePatterns);
  }

  var decorateSource = sourceDecorator({
        'keywords': ALL_KEYWORDS,
        'hashComments': true,
        'cStyleComments': true,
        'multiLineStrings': true,
        'regexLiterals': true
      });

  /**
   * Given a DOM subtree, wraps it in a list, and puts each line into its own
   * list item.
   *
   * @param {Node} node modified in place.  Its content is pulled into an
   *     HTMLOListElement, and each line is moved into a separate list item.
   *     This requires cloning elements, so the input might not have unique
   *     IDs after numbering.
   * @param {boolean} isPreformatted true iff white-space in text nodes should
   *     be treated as significant.
   */
  function numberLines(node, opt_startLineNum, isPreformatted) {
    var nocode = /(?:^|\s)nocode(?:\s|$)/;
    var lineBreak = /\r\n?|\n/;
  
    var document = node.ownerDocument;
  
    var li = document.createElement('li');
    while (node.firstChild) {
      li.appendChild(node.firstChild);
    }
    // An array of lines.  We split below, so this is initialized to one
    // un-split line.
    var listItems = [li];
  
    function walk(node) {
      var type = node.nodeType;
      if (type == 1 && !nocode.test(node.className)) {  // Element
        if ('br' === node.nodeName) {
          breakAfter(node);
          // Discard the <BR> since it is now flush against a </LI>.
          if (node.parentNode) {
            node.parentNode.removeChild(node);
          }
        } else {
          for (var child = node.firstChild; child; child = child.nextSibling) {
            walk(child);
          }
        }
      } else if ((type == 3 || type == 4) && isPreformatted) {  // Text
        var text = node.nodeValue;
        var match = text.match(lineBreak);
        if (match) {
          var firstLine = text.substring(0, match.index);
          node.nodeValue = firstLine;
          var tail = text.substring(match.index + match[0].length);
          if (tail) {
            var parent = node.parentNode;
            parent.insertBefore(
              document.createTextNode(tail), node.nextSibling);
          }
          breakAfter(node);
          if (!firstLine) {
            // Don't leave blank text nodes in the DOM.
            node.parentNode.removeChild(node);
          }
        }
      }
    }
  
    // Split a line after the given node.
    function breakAfter(lineEndNode) {
      // If there's nothing to the right, then we can skip ending the line
      // here, and move root-wards since splitting just before an end-tag
      // would require us to create a bunch of empty copies.
      while (!lineEndNode.nextSibling) {
        lineEndNode = lineEndNode.parentNode;
        if (!lineEndNode) { return; }
      }
  
      function breakLeftOf(limit, copy) {
        // Clone shallowly if this node needs to be on both sides of the break.
        var rightSide = copy ? limit.cloneNode(false) : limit;
        var parent = limit.parentNode;
        if (parent) {
          // We clone the parent chain.
          // This helps us resurrect important styling elements that cross lines.
          // E.g. in <i>Foo<br>Bar</i>
          // should be rewritten to <li><i>Foo</i></li><li><i>Bar</i></li>.
          var parentClone = breakLeftOf(parent, 1);
          // Move the clone and everything to the right of the original
          // onto the cloned parent.
          var next = limit.nextSibling;
          parentClone.appendChild(rightSide);
          for (var sibling = next; sibling; sibling = next) {
            next = sibling.nextSibling;
            parentClone.appendChild(sibling);
          }
        }
        return rightSide;
      }
  
      var copiedListItem = breakLeftOf(lineEndNode.nextSibling, 0);
  
      // Walk the parent chain until we reach an unattached LI.
      for (var parent;
           // Check nodeType since IE invents document fragments.
           (parent = copiedListItem.parentNode) && parent.nodeType === 1;) {
        copiedListItem = parent;
      }
      // Put it on the list of lines for later processing.
      listItems.push(copiedListItem);
    }
  
    // Split lines while there are lines left to split.
    for (var i = 0;  // Number of lines that have been split so far.
         i < listItems.length;  // length updated by breakAfter calls.
         ++i) {
      walk(listItems[i]);
    }
  
    // Make sure numeric indices show correctly.
    if (opt_startLineNum === (opt_startLineNum|0)) {
      listItems[0].setAttribute('value', opt_startLineNum);
    }
  
    var ol = document.createElement('ol');
    ol.className = 'linenums';
    var offset = Math.max(0, ((opt_startLineNum - 1 /* zero index */)) | 0) || 0;
    for (var i = 0, n = listItems.length; i < n; ++i) {
      li = listItems[i];
      // Stick a class on the LIs so that stylesheets can
      // color odd/even rows, or any other row pattern that
      // is co-prime with 10.
      li.className = 'L' + ((i + offset) % 10);
      if (!li.firstChild) {
        li.appendChild(document.createTextNode('\xA0'));
      }
      ol.appendChild(li);
    }
  
    node.appendChild(ol);
  }
  /**
   * Breaks {@code job.sourceCode} around style boundaries in
   * {@code job.decorations} and modifies {@code job.sourceNode} in place.
   * @param {Object} job like <pre>{
   *    sourceCode: {string} source as plain text,
   *    sourceNode: {HTMLElement} the element containing the source,
   *    spans: {Array.<number|Node>} alternating span start indices into source
   *       and the text node or element (e.g. {@code <BR>}) corresponding to that
   *       span.
   *    decorations: {Array.<number|string} an array of style classes preceded
   *       by the position at which they start in job.sourceCode in order
   * }</pre>
   * @private
   */
  function recombineTagsAndDecorations(job) {
    var isIE8OrEarlier = /\bMSIE\s(\d+)/.exec(navigator.userAgent);
    isIE8OrEarlier = isIE8OrEarlier && +isIE8OrEarlier[1] <= 8;
    var newlineRe = /\n/g;
  
    var source = job.sourceCode;
    var sourceLength = source.length;
    // Index into source after the last code-unit recombined.
    var sourceIndex = 0;
  
    var spans = job.spans;
    var nSpans = spans.length;
    // Index into spans after the last span which ends at or before sourceIndex.
    var spanIndex = 0;
  
    var decorations = job.decorations;
    var nDecorations = decorations.length;
    // Index into decorations after the last decoration which ends at or before
    // sourceIndex.
    var decorationIndex = 0;
  
    // Remove all zero-length decorations.
    decorations[nDecorations] = sourceLength;
    var decPos, i;
    for (i = decPos = 0; i < nDecorations;) {
      if (decorations[i] !== decorations[i + 2]) {
        decorations[decPos++] = decorations[i++];
        decorations[decPos++] = decorations[i++];
      } else {
        i += 2;
      }
    }
    nDecorations = decPos;
  
    // Simplify decorations.
    for (i = decPos = 0; i < nDecorations;) {
      var startPos = decorations[i];
      // Conflate all adjacent decorations that use the same style.
      var startDec = decorations[i + 1];
      var end = i + 2;
      while (end + 2 <= nDecorations && decorations[end + 1] === startDec) {
        end += 2;
      }
      decorations[decPos++] = startPos;
      decorations[decPos++] = startDec;
      i = end;
    }
  
    nDecorations = decorations.length = decPos;
  
    var sourceNode = job.sourceNode;
    var oldDisplay;
    if (sourceNode) {
      oldDisplay = sourceNode.style.display;
      sourceNode.style.display = 'none';
    }
    try {
      var decoration = null;
      while (spanIndex < nSpans) {
        var spanStart = spans[spanIndex];
        var spanEnd = spans[spanIndex + 2] || sourceLength;
  
        var decEnd = decorations[decorationIndex + 2] || sourceLength;
  
        var end = Math.min(spanEnd, decEnd);
  
        var textNode = spans[spanIndex + 1];
        var styledText;
        if (textNode.nodeType !== 1  // Don't muck with <BR>s or <LI>s
            // Don't introduce spans around empty text nodes.
            && (styledText = source.substring(sourceIndex, end))) {
          // This may seem bizarre, and it is.  Emitting LF on IE causes the
          // code to display with spaces instead of line breaks.
          // Emitting Windows standard issue linebreaks (CRLF) causes a blank
          // space to appear at the beginning of every line but the first.
          // Emitting an old Mac OS 9 line separator makes everything spiffy.
          if (isIE8OrEarlier) {
            styledText = styledText.replace(newlineRe, '\r');
          }
          textNode.nodeValue = styledText;
          var document = textNode.ownerDocument;
          var span = document.createElement('span');
          span.className = decorations[decorationIndex + 1];
          var parentNode = textNode.parentNode;
          parentNode.replaceChild(span, textNode);
          span.appendChild(textNode);
          if (sourceIndex < spanEnd) {  // Split off a text node.
            spans[spanIndex + 1] = textNode
                // TODO: Possibly optimize by using '' if there's no flicker.
                = document.createTextNode(source.substring(end, spanEnd));
            parentNode.insertBefore(textNode, span.nextSibling);
          }
        }
  
        sourceIndex = end;
  
        if (sourceIndex >= spanEnd) {
          spanIndex += 2;
        }
        if (sourceIndex >= decEnd) {
          decorationIndex += 2;
        }
      }
    } finally {
      if (sourceNode) {
        sourceNode.style.display = oldDisplay;
      }
    }
  }

  /** Maps language-specific file extensions to handlers. */
  var langHandlerRegistry = {};
  /** Register a language handler for the given file extensions.
    * @param {function (Object)} handler a function from source code to a list
    *      of decorations.  Takes a single argument job which describes the
    *      state of the computation.   The single parameter has the form
    *      {@code {
    *        sourceCode: {string} as plain text.
    *        decorations: {Array.<number|string>} an array of style classes
    *                     preceded by the position at which they start in
    *                     job.sourceCode in order.
    *                     The language handler should assigned this field.
    *        basePos: {int} the position of source in the larger source chunk.
    *                 All positions in the output decorations array are relative
    *                 to the larger source chunk.
    *      } }
    * @param {Array.<string>} fileExtensions
    */
  function registerLangHandler(handler, fileExtensions) {
    for (var i = fileExtensions.length; --i >= 0;) {
      var ext = fileExtensions[i];
      if (!langHandlerRegistry.hasOwnProperty(ext)) {
        langHandlerRegistry[ext] = handler;
      } else if (win['console']) {
        console['warn']('cannot override language handler %s', ext);
      }
    }
  }
  function langHandlerForExtension(extension, source) {
    if (!(extension && langHandlerRegistry.hasOwnProperty(extension))) {
      // Treat it as markup if the first non whitespace character is a < and
      // the last non-whitespace character is a >.
      extension = /^\s*</.test(source)
          ? 'default-markup'
          : 'default-code';
    }
    return langHandlerRegistry[extension];
  }
  registerLangHandler(decorateSource, ['default-code']);
  registerLangHandler(
      createSimpleLexer(
          [],
          [
           [PR_PLAIN,       /^[^<?]+/],
           [PR_DECLARATION, /^<!\w[^>]*(?:>|$)/],
           [PR_COMMENT,     /^<\!--[\s\S]*?(?:-\->|$)/],
           // Unescaped content in an unknown language
           ['lang-',        /^<\?([\s\S]+?)(?:\?>|$)/],
           ['lang-',        /^<%([\s\S]+?)(?:%>|$)/],
           [PR_PUNCTUATION, /^(?:<[%?]|[%?]>)/],
           ['lang-',        /^<xmp\b[^>]*>([\s\S]+?)<\/xmp\b[^>]*>/i],
           // Unescaped content in javascript.  (Or possibly vbscript).
           ['lang-js',      /^<script\b[^>]*>([\s\S]*?)(<\/script\b[^>]*>)/i],
           // Contains unescaped stylesheet content
           ['lang-css',     /^<style\b[^>]*>([\s\S]*?)(<\/style\b[^>]*>)/i],
           ['lang-in.tag',  /^(<\/?[a-z][^<>]*>)/i]
          ]),
      ['default-markup', 'htm', 'html', 'mxml', 'xhtml', 'xml', 'xsl']);
  registerLangHandler(
      createSimpleLexer(
          [
           [PR_PLAIN,        /^[\s]+/, null, ' \t\r\n'],
           [PR_ATTRIB_VALUE, /^(?:\"[^\"]*\"?|\'[^\']*\'?)/, null, '\"\'']
           ],
          [
           [PR_TAG,          /^^<\/?[a-z](?:[\w.:-]*\w)?|\/?>$/i],
           [PR_ATTRIB_NAME,  /^(?!style[\s=]|on)[a-z](?:[\w:-]*\w)?/i],
           ['lang-uq.val',   /^=\s*([^>\'\"\s]*(?:[^>\'\"\s\/]|\/(?=\s)))/],
           [PR_PUNCTUATION,  /^[=<>\/]+/],
           ['lang-js',       /^on\w+\s*=\s*\"([^\"]+)\"/i],
           ['lang-js',       /^on\w+\s*=\s*\'([^\']+)\'/i],
           ['lang-js',       /^on\w+\s*=\s*([^\"\'>\s]+)/i],
           ['lang-css',      /^style\s*=\s*\"([^\"]+)\"/i],
           ['lang-css',      /^style\s*=\s*\'([^\']+)\'/i],
           ['lang-css',      /^style\s*=\s*([^\"\'>\s]+)/i]
           ]),
      ['in.tag']);
  registerLangHandler(
      createSimpleLexer([], [[PR_ATTRIB_VALUE, /^[\s\S]+/]]), ['uq.val']);
  registerLangHandler(sourceDecorator({
          'keywords': CPP_KEYWORDS,
          'hashComments': true,
          'cStyleComments': true,
          'types': C_TYPES
        }), ['c', 'cc', 'cpp', 'cxx', 'cyc', 'm']);
  registerLangHandler(sourceDecorator({
          'keywords': 'null,true,false'
        }), ['json']);
  registerLangHandler(sourceDecorator({
          'keywords': CSHARP_KEYWORDS,
          'hashComments': true,
          'cStyleComments': true,
          'verbatimStrings': true,
          'types': C_TYPES
        }), ['cs']);
  registerLangHandler(sourceDecorator({
          'keywords': JAVA_KEYWORDS,
          'cStyleComments': true
        }), ['java']);
  registerLangHandler(sourceDecorator({
          'keywords': SH_KEYWORDS,
          'hashComments': true,
          'multiLineStrings': true
        }), ['bash', 'bsh', 'csh', 'sh']);
  registerLangHandler(sourceDecorator({
          'keywords': PYTHON_KEYWORDS,
          'hashComments': true,
          'multiLineStrings': true,
          'tripleQuotedStrings': true
        }), ['cv', 'py', 'python']);
  registerLangHandler(sourceDecorator({
          'keywords': PERL_KEYWORDS,
          'hashComments': true,
          'multiLineStrings': true,
          'regexLiterals': 2  // multiline regex literals
        }), ['perl', 'pl', 'pm']);
  registerLangHandler(sourceDecorator({
          'keywords': RUBY_KEYWORDS,
          'hashComments': true,
          'multiLineStrings': true,
          'regexLiterals': true
        }), ['rb', 'ruby']);
  registerLangHandler(sourceDecorator({
          'keywords': JSCRIPT_KEYWORDS,
          'cStyleComments': true,
          'regexLiterals': true
        }), ['javascript', 'js']);
  registerLangHandler(sourceDecorator({
          'keywords': COFFEE_KEYWORDS,
          'hashComments': 3,  // ### style block comments
          'cStyleComments': true,
          'multilineStrings': true,
          'tripleQuotedStrings': true,
          'regexLiterals': true
        }), ['coffee']);
  registerLangHandler(sourceDecorator({
          'keywords': RUST_KEYWORDS,
          'cStyleComments': true,
          'multilineStrings': true
        }), ['rc', 'rs', 'rust']);
  registerLangHandler(
      createSimpleLexer([], [[PR_STRING, /^[\s\S]+/]]), ['regex']);

  function applyDecorator(job) {
    var opt_langExtension = job.langExtension;

    try {
      // Extract tags, and convert the source code to plain text.
      var sourceAndSpans = extractSourceSpans(job.sourceNode, job.pre);
      /** Plain text. @type {string} */
      var source = sourceAndSpans.sourceCode;
      job.sourceCode = source;
      job.spans = sourceAndSpans.spans;
      job.basePos = 0;

      // Apply the appropriate language handler
      langHandlerForExtension(opt_langExtension, source)(job);

      // Integrate the decorations and tags back into the source code,
      // modifying the sourceNode in place.
      recombineTagsAndDecorations(job);
    } catch (e) {
      if (win['console']) {
        console['log'](e && e['stack'] || e);
      }
    }
  }

  /**
   * Pretty print a chunk of code.
   * @param sourceCodeHtml {string} The HTML to pretty print.
   * @param opt_langExtension {string} The language name to use.
   *     Typically, a filename extension like 'cpp' or 'java'.
   * @param opt_numberLines {number|boolean} True to number lines,
   *     or the 1-indexed number of the first line in sourceCodeHtml.
   */
  function $prettyPrintOne(sourceCodeHtml, opt_langExtension, opt_numberLines) {
    var container = document.createElement('div');
    // This could cause images to load and onload listeners to fire.
    // E.g. <img onerror="alert(1337)" src="nosuchimage.png">.
    // We assume that the inner HTML is from a trusted source.
    // The pre-tag is required for IE8 which strips newlines from innerHTML
    // when it is injected into a <pre> tag.
    // http://stackoverflow.com/questions/451486/pre-tag-loses-line-breaks-when-setting-innerhtml-in-ie
    // http://stackoverflow.com/questions/195363/inserting-a-newline-into-a-pre-tag-ie-javascript
    container.innerHTML = '<pre>' + sourceCodeHtml + '</pre>';
    container = container.firstChild;
    if (opt_numberLines) {
      numberLines(container, opt_numberLines, true);
    }

    var job = {
      langExtension: opt_langExtension,
      numberLines: opt_numberLines,
      sourceNode: container,
      pre: 1
    };
    applyDecorator(job);
    return container.innerHTML;
  }

   /**
    * Find all the {@code <pre>} and {@code <code>} tags in the DOM with
    * {@code class=prettyprint} and prettify them.
    *
    * @param {Function} opt_whenDone called when prettifying is done.
    * @param {HTMLElement|HTMLDocument} opt_root an element or document
    *   containing all the elements to pretty print.
    *   Defaults to {@code document.body}.
    */
  function $prettyPrint(opt_whenDone, opt_root) {
    var root = opt_root || document.body;
    var doc = root.ownerDocument || document;
    function byTagName(tn) { return root.getElementsByTagName(tn); }
    // fetch a list of nodes to rewrite
    var codeSegments = [byTagName('pre'), byTagName('code'), byTagName('xmp')];
    var elements = [];
    for (var i = 0; i < codeSegments.length; ++i) {
      for (var j = 0, n = codeSegments[i].length; j < n; ++j) {
        elements.push(codeSegments[i][j]);
      }
    }
    codeSegments = null;

    var clock = Date;
    if (!clock['now']) {
      clock = { 'now': function () { return +(new Date); } };
    }

    // The loop is broken into a series of continuations to make sure that we
    // don't make the browser unresponsive when rewriting a large page.
    var k = 0;
    var prettyPrintingJob;

    var langExtensionRe = /\blang(?:uage)?-([\w.]+)(?!\S)/;
    var prettyPrintRe = /\bprettyprint\b/;
    var prettyPrintedRe = /\bprettyprinted\b/;
    var preformattedTagNameRe = /pre|xmp/i;
    var codeRe = /^code$/i;
    var preCodeXmpRe = /^(?:pre|code|xmp)$/i;
    var EMPTY = {};

    function doWork() {
      var endTime = (win['PR_SHOULD_USE_CONTINUATION'] ?
                     clock['now']() + 250 /* ms */ :
                     Infinity);
      for (; k < elements.length && clock['now']() < endTime; k++) {
        var cs = elements[k];

        // Look for a preceding comment like
        // <?prettify lang="..." linenums="..."?>
        var attrs = EMPTY;
        {
          for (var preceder = cs; (preceder = preceder.previousSibling);) {
            var nt = preceder.nodeType;
            // <?foo?> is parsed by HTML 5 to a comment node (8)
            // like <!--?foo?-->, but in XML is a processing instruction
            var value = (nt === 7 || nt === 8) && preceder.nodeValue;
            if (value
                ? !/^\??prettify\b/.test(value)
                : (nt !== 3 || /\S/.test(preceder.nodeValue))) {
              // Skip over white-space text nodes but not others.
              break;
            }
            if (value) {
              attrs = {};
              value.replace(
                  /\b(\w+)=([\w:.%+-]+)/g,
                function (_, name, value) { attrs[name] = value; });
              break;
            }
          }
        }

        var className = cs.className;
        if ((attrs !== EMPTY || prettyPrintRe.test(className))
            // Don't redo this if we've already done it.
            // This allows recalling pretty print to just prettyprint elements
            // that have been added to the page since last call.
            && !prettyPrintedRe.test(className)) {

          // make sure this is not nested in an already prettified element
          var nested = false;
          for (var p = cs.parentNode; p; p = p.parentNode) {
            var tn = p.tagName;
            if (preCodeXmpRe.test(tn)
                && p.className && prettyPrintRe.test(p.className)) {
              nested = true;
              break;
            }
          }
          if (!nested) {
            // Mark done.  If we fail to prettyprint for whatever reason,
            // we shouldn't try again.
            cs.className += ' prettyprinted';

            // If the classes includes a language extensions, use it.
            // Language extensions can be specified like
            //     <pre class="prettyprint lang-cpp">
            // the language extension "cpp" is used to find a language handler
            // as passed to PR.registerLangHandler.
            // HTML5 recommends that a language be specified using "language-"
            // as the prefix instead.  Google Code Prettify supports both.
            // http://dev.w3.org/html5/spec-author-view/the-code-element.html
            var langExtension = attrs['lang'];
            if (!langExtension) {
              langExtension = className.match(langExtensionRe);
              // Support <pre class="prettyprint"><code class="language-c">
              var wrapper;
              if (!langExtension && (wrapper = childContentWrapper(cs))
                  && codeRe.test(wrapper.tagName)) {
                langExtension = wrapper.className.match(langExtensionRe);
              }

              if (langExtension) { langExtension = langExtension[1]; }
            }

            var preformatted;
            if (preformattedTagNameRe.test(cs.tagName)) {
              preformatted = 1;
            } else {
              var currentStyle = cs['currentStyle'];
              var defaultView = doc.defaultView;
              var whitespace = (
                  currentStyle
                  ? currentStyle['whiteSpace']
                  : (defaultView
                     && defaultView.getComputedStyle)
                  ? defaultView.getComputedStyle(cs, null)
                  .getPropertyValue('white-space')
                  : 0);
              preformatted = whitespace
                  && 'pre' === whitespace.substring(0, 3);
            }

            // Look for a class like linenums or linenums:<n> where <n> is the
            // 1-indexed number of the first line.
            var lineNums = attrs['linenums'];
            if (!(lineNums = lineNums === 'true' || +lineNums)) {
              lineNums = className.match(/\blinenums\b(?::(\d+))?/);
              lineNums =
                lineNums
                ? lineNums[1] && lineNums[1].length
                  ? +lineNums[1] : true
                : false;
            }
            if (lineNums) { numberLines(cs, lineNums, preformatted); }

            // do the pretty printing
            prettyPrintingJob = {
              langExtension: langExtension,
              sourceNode: cs,
              numberLines: lineNums,
              pre: preformatted
            };
            applyDecorator(prettyPrintingJob);
          }
        }
      }
      if (k < elements.length) {
        // finish up in a continuation
        setTimeout(doWork, 250);
      } else if ('function' === typeof opt_whenDone) {
        opt_whenDone();
      }
    }

    doWork();
  }

  /**
   * Contains functions for creating and registering new language handlers.
   * @type {Object}
   */
  var PR = win['PR'] = {
        'createSimpleLexer': createSimpleLexer,
        'registerLangHandler': registerLangHandler,
        'sourceDecorator': sourceDecorator,
        'PR_ATTRIB_NAME': PR_ATTRIB_NAME,
        'PR_ATTRIB_VALUE': PR_ATTRIB_VALUE,
        'PR_COMMENT': PR_COMMENT,
        'PR_DECLARATION': PR_DECLARATION,
        'PR_KEYWORD': PR_KEYWORD,
        'PR_LITERAL': PR_LITERAL,
        'PR_NOCODE': PR_NOCODE,
        'PR_PLAIN': PR_PLAIN,
        'PR_PUNCTUATION': PR_PUNCTUATION,
        'PR_SOURCE': PR_SOURCE,
        'PR_STRING': PR_STRING,
        'PR_TAG': PR_TAG,
        'PR_TYPE': PR_TYPE,
        'prettyPrintOne':
           IN_GLOBAL_SCOPE
             ? (win['prettyPrintOne'] = $prettyPrintOne)
             : (prettyPrintOne = $prettyPrintOne),
        'prettyPrint': prettyPrint =
           IN_GLOBAL_SCOPE
             ? (win['prettyPrint'] = $prettyPrint)
             : (prettyPrint = $prettyPrint)
      };

  // Make PR available via the Asynchronous Module Definition (AMD) API.
  // Per https://github.com/amdjs/amdjs-api/wiki/AMD:
  // The Asynchronous Module Definition (AMD) API specifies a
  // mechanism for defining modules such that the module and its
  // dependencies can be asynchronously loaded.
  // ...
  // To allow a clear indicator that a global define function (as
  // needed for script src browser loading) conforms to the AMD API,
  // any global define function SHOULD have a property called "amd"
  // whose value is an object. This helps avoid conflict with any
  // other existing JavaScript code that could have defined a define()
  // function that does not conform to the AMD API.
  if (typeof define === "function" && define['amd']) {
    define("google-code-prettify", [], function () {
      return PR; 
    });
  }
})();
