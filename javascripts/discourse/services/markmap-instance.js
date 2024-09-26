import Service, { service } from "@ember/service";
import { Transformer } from "../lib/markmap/transform";
import { Markmap } from "../lib/markmap/view";
import { defaultOptions } from "../lib/markmap/view/constants";

export default class MarkmapInstance extends Service {
  @service modal;
  @service markmapManager;

  transformer = new Transformer();
  instances = new Map();
  renderCounts = new Map();
  dynamicOpts = new Map();

  lookup(handler) {
    return this.instances.get(handler);
  }

  create(handler, svg, options) {
    const instance = Markmap.create(svg, options);
    this.instances.set(handler, instance);

    return instance;
  }

  trackRenderCount(handler) {
    if (!this.renderCounts.has(handler)) {
      this.renderCounts.set(handler, 1);
    } else {
      this.renderCounts.set(handler, this.renderCounts.get(handler) + 1);
    }
  }

  resetRenderCounts(handlers) {
    if (!Array.isArray(handlers)) {
      handlers = [handlers];
    }

    for (const handler of handlers) {
      this.renderCounts.set(handler, 0);
    }
  }

  clear() {
    this.instances.clear();
    this.renderCounts.clear();
    this.dynamicOpts.clear();
  }

  isFirstRender(handler) {
    return this.renderCounts.get(handler) === 1;
  }

  deriveOptions(options, flags = { useDefault: true }) {
    const allowedFields = {
      title: "string",
      color: "color", // order is important
      colorFreezeLevel: "number", // order is important
      autoFit: "boolean",
      //embedGlobalCSS: "boolean",
      scrollForPan: "boolean",
      pan: "boolean",
      toggleRecursively: "boolean",
      zoom: "boolean",
      duration: "number",
      initialExpandLevel: "number",
      maxWidth: "number",
      paddingX: "number",
      nodeMinHeight: "number",
      spacingHorizontal: "number",
      spacingVertical: "number",
      fitRatio: "float",

      // Custom
      maxHeight: "number",
      index: "number",
      postId: "string",
    };

    if (flags.useDefault) {
      options = { ...defaultOptions, ...options };
    }

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
          newOptions[key] = value;
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

  async refreshTransform(wrapElement, lastPosition = null) {
    const instance = this.lookup(wrapElement.dataset.handler);
    const options = this.deriveOptions(wrapElement.dataset);
    const { duration } = options;

    instance.setData(this.transformHtml(wrapElement), {
      ...options,
      duration: 0 /* Avoid transition effect if we force a refresh */,
    });

    let promise;

    if (lastPosition) {
      promise = instance.fit(lastPosition).then(async () => {});
    } else {
      promise = this.autoFitHeight(wrapElement, options, lastPosition);
    }

    return promise.then(() => {
      instance.setOptions({
        duration,
      });
    });
  }

  async autoFitHeight(wrapElement, options, lastPosition = null) {
    const handler = wrapElement.dataset.handler;
    const instance = this.lookup(handler);

    options = this.deriveOptions(options);
    const { maxHeight, fitRatio, postId, index } = options;

    if (!instance) {
      return null;
    }

    const svg = wrapElement.nextElementSibling?.querySelector("svg.markmap");
    if (!svg) {
      return null;
    }

    const autoFit = () => {
      const svgHeight = svg.getBoundingClientRect().height;
      const gHeight = Math.floor(
        svg.querySelector("g").getBoundingClientRect().height / fitRatio
      );

      return {
        needsUpdate: gHeight < maxHeight && gHeight < svgHeight,
        newHeight: gHeight,
      };
    };

    const updateAndFit = async (height) => {
      svg.style.height = `${height}px`;
      wrapElement.dataset.autoFitHeight = height;

      let dynamicOpts = this.dynamicOpts.get(handler) || {};
      this.dynamicOpts.set(handler, {
        ...dynamicOpts,
        autoFitHeight: height,
      });

      if (postId) {
        const postHandler = this.markmapManager.uniqueKey({
          index,
          postId,
        });

        dynamicOpts = this.dynamicOpts.get(postHandler) || {};
        this.dynamicOpts.set(postHandler, {
          ...dynamicOpts,
          autoFitHeight: height,
        });
      }

      return instance.fit(lastPosition);
    };

    const autoFitHeight = this.dynamicOpts.get(handler)?.autoFitHeight;

    if (autoFitHeight) {
      const height = Math.min(autoFitHeight, maxHeight);
      return updateAndFit(height);
    } else {
      svg.style.height = `${maxHeight}px`;
      await instance.fit();
    }

    const { needsUpdate, newHeight } = autoFit();

    if (needsUpdate) {
      return updateAndFit(newHeight);
    }
  }
}
