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

  clear() {
    console.log("clear");
    this.instances.clear();
    this.renderCounts.clear();
  }

  isFirstRender(handler) {
    //console.log("isFirstRender", handler, this.renderCounts.get(handler));
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

  async refreshTransform(wrapElement, lastPosition = null, isPreview) {
    const instance = this.lookup(wrapElement.dataset.handler);
    const options = this.deriveOptions(wrapElement.dataset);
    const { duration } = options;

    instance.setData(this.transformHtml(wrapElement), {
      ...options,
      duration: 0 /* Avoid transition effect if we force a refresh */,
    });

    return instance.fit(lastPosition).then(async () => {
      //console.log("wrapElement.dataset.autoFitHeight", instance.autoFitHeight);
      if (!instance.autoFitHeight) {
        //await this.autoFitHeight(instance, wrapElement, options);
      }

      instance.setOptions({
        duration,
      });
    });
  }

  async autoFitHeight(instance, wrapElement, options) {
    const svg = wrapElement.nextElementSibling.querySelector("svg.markmap");

    svg.style.height = `${options.maxHeight}px`;
    await instance.fit();

    const svgHeight = svg.getBoundingClientRect().height;
    const gHeight =
      svg.querySelector("g").getBoundingClientRect().height / options.fitRatio;

    if (gHeight < options.maxHeight && gHeight < svgHeight) {
      svg.style.height = `${gHeight}px`;
      wrapElement.dataset.autoFitHeight = gHeight;

      const handler = wrapElement.dataset.handler;
      const dynamicOpts = this.dynamicOpts.get(handler) || {};
      this.dynamicOpts.set(handler, {
        ...dynamicOpts,
        autoFitHeight: true,
      });

      instance.autoFitHeight = true;
      // console.log("instance", instance);

      await instance.fit();
    }
  }
}
