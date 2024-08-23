import { iconHTML } from "discourse-common/lib/icon-library";

export const clsToolbarItem = "mm-toolbar-item";
export const clsActive = "active";

function createElement(tag, attrs, ...children) {
  const element =
    tag === "path" || tag === "svg"
      ? document.createElementNS("http://www.w3.org/2000/svg", tag)
      : document.createElement(tag);

  for (const [key, value] of Object.entries(attrs || {})) {
    if (key.startsWith("on")) {
      element.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "className") {
      element.className = value;
    } else {
      element.setAttribute(key, value);
    }
  }

  for (const child of children) {
    if (typeof child === "string") {
      element.appendChild(document.createTextNode(child));
    } else if (child) {
      element.appendChild(child);
    }
  }

  return element;
}

function renderItem({ type, title, icon, onClick }) {
  if (type === "separator") {
    return createElement("div", { className: "mm-toolbar-separator" });
  }

  const element = createElement("div", {
    className: clsToolbarItem,
    title,
    onClick,
  });

  element.innerHTML = iconHTML(icon);

  return element;
}

let promise;

function safeCaller(fn) {
  return async (...args) => {
    if (promise) {
      return;
    }
    promise = fn(...args);
    try {
      await promise;
    } finally {
      promise = undefined;
    }
  };
}

class Toolbar {
  static create(mm) {
    const toolbar = new Toolbar();
    toolbar.attach(mm);

    return toolbar;
  }

  constructor() {
    this.registry = {};
    this.markmap = undefined;
    this.el = createElement("div", { className: "mm-toolbar" });
  }

  register(data) {
    this.registry[data.id] = data;
  }

  getHandler(handle) {
    handle = safeCaller(handle);
    return () => {
      if (this.markmap) {
        handle(this.markmap);
      }
    };
  }

  setItems(items) {
    this.items = [...items];
    return this.render();
  }

  attach(mm) {
    this.markmap = mm;
  }

  render() {
    const items = this.items
      .map((item) => {
        if (typeof item === "string") {
          if (item === "separator") {
            return { type: item };
          }

          const data = this.registry[item];
          if (!data) {
            console.warn(`[markmap-toolbar] ${item} not found`);
          }
          return { ...data, type: "icon" };
        }
        return { ...item, type: "icon" };
      })
      .filter(Boolean);

    while (this.el.firstChild) {
      this.el.firstChild.remove();
    }

    this.el.append(...items.map(renderItem));

    return this.el;
  }
}

export { Toolbar };
