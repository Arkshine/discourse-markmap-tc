const uniqId = Math.random().toString(36).slice(2, 8);
let globalIndex = 0;

export function getId() {
  globalIndex += 1;
  return `mm-${uniqId}-${globalIndex}`;
}

export function noop() {
  // noop
}

export function walkTree(tree, callback, params = {}) {
  const walk = (item, parent) =>
    callback(
      item,
      () =>
        item.children
          ? item.children.map((child) => walk(child, item))
          : undefined,
      parent,
      params
    );

  return walk(tree);
}

export function addClass(className, ...rest) {
  const classList = (className || "").split(" ").filter(Boolean);

  rest.forEach((item) => {
    if (item && classList.indexOf(item) < 0) {
      classList.push(item);
    }
  });

  return classList.join(" ");
}

export function childSelector(filter) {
  if (typeof filter === "string") {
    const tagName = filter;

    filter = function (el) {
      return el.tagName === tagName;
    };
  }

  const filterFn = filter;

  return function selector() {
    let nodes = Array.from(this.childNodes);

    if (filterFn) {
      nodes = nodes.filter((node) => filterFn(node));
    }

    return nodes;
  };
}

export function wrapFunction(fn, wrapper) {
  return (...args) => wrapper(fn, ...args);
}

export function defer() {
  const obj = {};

  obj.promise = new Promise((resolve, reject) => {
    obj.resolve = resolve;
    obj.reject = reject;
  });

  return obj;
}

export function memoize(fn) {
  const cache = {};

  return function memoized(...args) {
    const key = `${args[0]}`;
    let data = cache[key];

    if (!data) {
      data = {
        value: fn(...args),
      };
      cache[key] = data;
    }

    return data.value;
  };
}

export function debounce(fn, time) {
  const state = {
    timer: 0,
  };

  function reset() {
    if (state.timer) {
      window.clearTimeout(state.timer);
      state.timer = 0;
    }
  }

  function run() {
    reset();
    if (state.args) {
      state.result = fn(...state.args);
    }
  }

  return function debounced(...args) {
    reset();
    state.args = args;
    state.timer = window.setTimeout(run, time);
    return state.result;
  };
}
