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

      color: "color", // order is important
      colorFreezeLevel: "number", // order is important

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
        let value = options[key];

        if (value === undefined || typeof value === "function") {
          continue;
        }

        if (type === "boolean") {
          if (typeof value === "boolean") {
            newOptions[key] = value;
          } else if (typeof value === "string") {
            newOptions[key] = value.toLowerCase() === "true";
          } else {
            newOptions[key] = !!parseInt(value, 10);
          }
        } else if (type === "number") {
          newOptions[key] = parseInt(value, 10);

          if (key === "colorFreezeLevel") {
            const _color = newOptions.color || defaultOptions.color;
            newOptions.color = (node) => {
              node = {
                ...node,
                state: {
                  ...node.state,
                  path: node.state.path
                    .split(".")
                    .slice(0, newOptions[key])
                    .join("."),
                },
              };
              return _color(node);
            };
          }
        } else if (type === "float") {
          newOptions[key] = parseFloat(value);
        } else if (type === "string") {
          if (value.includes(",")) {
            newOptions[key] = value.split(",").map((item) => item.trim());
          } else {
            newOptions[key] = value;
          }
        } else if (type === "color") {
          if (typeof value === "string") {
            if (value.includes(",")) {
              value = value.split(",").map((item) => item.trim());
            } else {
              value = [value];
            }
          }

          if (value?.length) {
            const colorFn =
              value.length === 1
                ? () => value[0]
                : window.d3.scaleOrdinal(value);
            newOptions[key] = (node) => colorFn(`${node.state.path}`);
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
    instance.setOptions({
      duration,
    });
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
