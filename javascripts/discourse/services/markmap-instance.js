import { later } from "@ember/runloop";
import Service, { service } from "@ember/service";
import discourseDebounce from "discourse-common/lib/debounce";
import I18n from "discourse-i18n";
import FullscreenMarkmap from "../components/modal/fullscreen-markmap";
import { clsActive, clsToolbarItem, Toolbar } from "../lib/markmap/toolbar";
import { Transformer } from "../lib/markmap/transform";
import { Markmap } from "../lib/markmap/view";
import { defaultOptions } from "../lib/markmap/view/constants";

export default class MarkmapInstance extends Service {
  @service modal;

  transformer = new Transformer();
  instances = {};
  renderCounts = {};
  options = {};

  lookup(handler) {
    return this.instances[handler];
  }

  create(handler, svg, options) {
    const instance = Markmap.create(svg, options);

    this.instances[handler] = instance;

    if (this.renderCounts[handler] === undefined) {
      this.renderCounts[handler] = 0;
    }

    if (options !== null) {
      this.options[handler] = options;
    }

    ++this.renderCounts[handler];

    return instance;
  }

  isFirstRender(handler) {
    return this.renderCounts[handler] === 1;
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

  debouncedRefreshTransform(element, lastPosition = null) {
    discourseDebounce(
      this.refreshTransform.bind(this),
      element,
      lastPosition,
      0
    );
  }

  async refreshTransform(element, lastPosition = null) {
    const instance = this.lookup(element.dataset.handler);
    const options = this.deriveOptions(element.dataset);
    //const { duration } = options;

    instance.setData(this.transformHtml(element), {
      ...options,
      //duration: 0 /* Avoid transition effect if we force a refresh */,
    });

    instance.fit(lastPosition);
    /*next(() =>
      instance.setOptions({
        duration,
      })
    );*/
  }

  insertToolbar(handler, wrapper, attrs = {}) {
    const instance = this.lookup(handler);
    if (!instance) {
      return;
    }

    const toolbar = Toolbar.create(instance);
    const { el } = toolbar;

    const modalElement = document.querySelector(
      ".d-modal.fullscreen-markmap-modal"
    );

    toolbar.register({
      id: "zoomIn",
      title: I18n.t(themePrefix("toolbar.zoom_in")),
      icon: "zoom-in-markmap",
      onClick: toolbar.getHandler((mm) => mm.rescale(1.25)),
    });

    toolbar.register({
      id: "zoomOut",
      title: I18n.t(themePrefix("toolbar.zoom_out")),
      icon: "zoom-out-markmap",
      onClick: toolbar.getHandler((mm) => mm.rescale(0.8)),
    });

    toolbar.register({
      id: "fit",
      title: I18n.t(themePrefix("toolbar.fit")),
      icon: "fit-markmap",
      onClick: toolbar.getHandler((mm) => mm.fit()),
    });

    toolbar.register({
      id: "recurse",
      title: I18n.t(themePrefix("toolbar.recurse")),
      icon: "recurse-markmap",
      onClick: (e) => {
        const button = e.target.closest(`.${clsToolbarItem}`);
        const active = button?.classList.toggle(clsActive);
        toolbar.markmap?.setOptions({
          toggleRecursively: active,
        });
      },
    });

    toolbar.register({
      id: "fullscreen",
      title: I18n.t(themePrefix("toolbar.fullscreen")),
      icon: "fullscreen-markmap",
      onClick: () => {
        if (modalElement) {
          if (!document.fullscreenElement) {
            modalElement.querySelector(".d-modal__header").style.display =
              "none";

            modalElement.addEventListener("fullscreenchange", (event) => {
              if (!document.fullscreenElement) {
                event.target.querySelector(".d-modal__header").style.display =
                  "flex";
              }
            });

            modalElement.requestFullscreen();

            modalElement.addEventListener("fullscreenerror", (/*event*/) => {
              // eslint-disable-next-line no-console
              console.error("an error occurred changing into fullscreen");
            });

            this.lookup(wrapper.dataset.handler)?.fit();
          } else {
            if (document.exitFullscreen) {
              document.exitFullscreen();
              modalElement.querySelector(".d-modal__header").style.display =
                "block";
            }
          }
        } else {
          this.modal.show(FullscreenMarkmap, {
            model: {
              wrapElement: wrapper.previousElementSibling,
              attrs,
            },
          });
        }
      },
    });

    toolbar.register({
      id: "show-content",
      title: I18n.t(themePrefix("toolbar.show_content")),
      icon: "content-markmap",
      onClick: () => {
        const wrapElement = document.querySelector(
          `.d-wrap[data-handler="${handler}"]`
        );

        if (!wrapElement) {
          return;
        }

        wrapper.style.display = "none";

        wrapElement.style.position = "relative";
        wrapElement.style.visibility = "visible";
        wrapElement.style.left = "unset";
        wrapElement.querySelector(".mm-toolbar")?.remove();

        const toolbarContent = Toolbar.create(instance);
        wrapElement.insertBefore(toolbarContent.el, wrapElement.firstChild);

        toolbarContent.register({
          id: "show-markmap",
          title: I18n.t(themePrefix("toolbar.show_markmap")),
          icon: "diagram-markmap",
          onClick: () => {
            wrapper.style.display = "block";

            wrapElement.style.position = "absolute";
            wrapElement.style.visibility = "hidden";
            wrapElement.style.left = "-9999px";

            wrapElement.querySelector(".mm-toolbar")?.remove();
          },
        });

        toolbarContent.setItems(["show-markmap"]);
      },
    });

    wrapper.insertBefore(el, wrapper.firstChild);

    const items = ["zoomIn", "zoomOut", "fit", "recurse", "fullscreen"];

    if (!modalElement) {
      items.push("separator");
      items.push("show-content");
    }

    toolbar.setItems(items);
  }

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
