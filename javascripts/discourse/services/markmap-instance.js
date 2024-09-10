import { later, next } from "@ember/runloop";
import Service, { service } from "@ember/service";
import { Transformer } from "../lib/markmap/transform";
import { Markmap } from "../lib/markmap/view";
import { defaultOptions } from "../lib/markmap/view/constants";

export default class MarkmapInstance extends Service {
  @service modal;

  transformer = new Transformer();
  instances = new Map();
  renderCounts = new Map();

  lookup(handler) {
    return this.instances.get(handler);
  }

  create(handler, svg, options) {
    const instance = Markmap.create(svg, options);

    this.instances.set(handler, instance);

    if (!this.renderCounts.has(handler)) {
      this.renderCounts.set(handler, 0);
    }

    this.renderCounts.set(handler, this.renderCounts.get(handler) + 1);

    return instance;
  }

  clear() {
    this.instances.clear();
    this.renderCounts.clear();
  }

  isFirstRender(handler) {
    return this.renderCounts.get(handler) === 1;
  }

  deriveOptions(options) {
    const allowedFields = {
      title: "string",
      color: "string",

      autoFit: "boolean",
      embedGlobalCSS: "boolean",
      scrollForPan: "boolean",
      pan: "boolean",
      toggleRecursively: "boolean",
      zoom: "boolean",

      duration: "number",
      initialExpandLevel: "number",
      height: "number",
      maxWidth: "number",
      paddingX: "number",
      nodeMinHeight: "number",
      spacingHorizontal: "number",
      spacingVertical: "number",

      fitRatio: "float",
    };

    options = { ...defaultOptions, ...options };

    let newOptions = {};

    for (const key in options) {
      if (allowedFields.hasOwnProperty(key)) {
        const type = allowedFields[key];
        const value = options[key];

        if (value === undefined || typeof value === "function") {
          continue;
        }

        if (type === "boolean") {
          newOptions[key] = value === "true" || value === true;
        } else if (type === "number") {
          newOptions[key] = parseInt(value, 10);
        } else if (type === "float") {
          newOptions[key] = parseFloat(value);
        } else if (type === "string") {
          if (value.includes(",")) {
            newOptions[key] = value.split(",").map((item) => item.trim());
          } else {
            newOptions[key] = value;
          }
        }
      }
    }

    return newOptions;
  }

  transformHtml(element) {
    const { root } = this.transformer.transform(element.innerHTML, {
      title: element.dataset.title,
    });

    return root;
  }

  async refreshTransform(element, lastPosition = null) {
    const instance = this.lookup(element.dataset.handler);
    const options = this.deriveOptions(element.dataset);
    const { duration } = options;

    instance.setData(this.transformHtml(element), {
      ...options,
      duration: 0 /* Avoid transition effect if we force a refresh */,
    });

    instance.fit(lastPosition);
    next(() =>
      instance.setOptions({
        duration,
      })
    );
  }

  // TODO: Fix me ?
  autoFitHeight(handler, svg) {
    const svgHeight = svg.getBoundingClientRect().height;
    const gHeight = svg.querySelector("g")?.getBoundingClientRect().height;

    if (!gHeight) {
      return;
    }

    const instance = this.instance(handler).get();

    if (!instance) {
      return;
    }

    svg.style.height = `${this.getOptions(handler).height}px`;
    instance.fit();

    later(
      this,
      () => {
        if (gHeight < this.getOptions(handler).height && gHeight < svgHeight) {
          svg.style.height = `${gHeight}px`;
          instance.fit();
        }
      },
      1000
    );
  }
}
