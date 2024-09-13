import { later, next, schedule } from "@ember/runloop";
import Service, { service } from "@ember/service";
import lightbox, { setupLightboxes } from "discourse/lib/lightbox";
import {
  LIGHTBOX_APP_EVENT_NAMES,
  SELECTORS,
} from "discourse/lib/lightbox/constants";
import loadScript from "discourse/lib/load-script";
import { generateSpreadsheetModal } from "../lib/discourse/table";
import { walkTree } from "../lib/markmap/common";

export default class MarkmapManager extends Service {
  @service modal;
  @service siteSettings;
  @service appEvents;
  @service markmapInstance;
  @service markmapToolbar;

  previousSVGInComposer = new Map();
  foldNodesState = new Map();
  lastPosition = new Map();

  constructor() {
    super(...arguments);
    this.appEvents.on("composer:open", this, this.resetStateOnComposer);
  }

  willDestroy() {
    this.appEvents.off("composer:open", this, this.resetStateOnComposer);
    super.willDestroy(...arguments);
  }

  applyMarkmaps(element, key = "composer", isPreview, attrs = {}) {
    const markmaps = element.querySelectorAll('[data-wrap="markmap"]');

    if (!markmaps.length) {
      element
        .querySelectorAll(".markmap-wrapper")
        .forEach((wrapper) => wrapper.remove());
      return;
    }

    this.ensureLibraries().then(() => {
      markmaps.forEach((wrapElement, index) => {
        this.beforeRender(wrapElement);
        this.render({
          wrapElement,
          index,
          isPreview,
          attrs,
          key,
        });
      });
    });
  }

  async ensureLibraries() {
    await loadScript(settings.theme_uploads_local.d3_js);
    await loadScript(settings.theme_uploads_local.d3_flextree_js);
  }

  beforeRender(wrapElement) {
    if (this.siteSettings.checklist_enabled) {
      // Marks the checklist items to find them later in the proper order.
      wrapElement.querySelectorAll(".chcklst-box").forEach((element, index) => {
        element.dataset.index = index;
      });
    }
  }

  render({ wrapElement, index, isPreview, attrs, key }) {
    if (!wrapElement || wrapElement.dataset.processed) {
      return;
    }

    if (isPreview) {
      wrapElement.parentElement
        .querySelector(`.markmap-wrapper[data-index="${index}"]`)
        ?.remove();
    }

    const options = this.markmapInstance.deriveOptions(wrapElement.dataset);
    const handler = `${key}.${index}`;

    options.height = options.height || 400;

    // Wrapper to contain SVG and toolbar.
    const [svgWrapper, svg] = this.createWrapper({
      handler,
      index,
      width: "100%",
      height: `${options.height}px`,
      isPreview,
    });

    wrapElement.parentElement.insertBefore(svgWrapper, wrapElement.nextSibling);
    wrapElement.setAttribute("aria-hidden", "true");
    wrapElement.dataset.index = index;
    wrapElement.dataset.handler = handler;
    wrapElement.dataset.processed = true;

    return this.createMarkmap({
      wrapElement,
      svgWrapper,
      svg,
      attrs,
      handler,
      isPreview,
      options,
    });
  }

  renderInModal({ index = -1, containerElement, wrapElement, attrs = {} }) {
    const handler = "modal";

    const [svgWrapper, svg] = this.createWrapper({
      handler,
      index,
      width: "100%",
      height: "100vh",
    });

    containerElement.append(svgWrapper);

    return this.createMarkmap({
      wrapElement,
      svgWrapper,
      svg,
      attrs,
      handler: "modal",
      isPreview: false,
      options: {},
    });
  }

  createMarkmap({
    wrapElement,
    svgWrapper,
    svg,
    attrs,
    handler,
    isPreview,
    options,
  }) {
    let instance = null;

    if (isPreview) {
      instance = this.markmapInstance.lookup(handler);
    }

    if (!instance) {
      instance = this.markmapInstance.create(handler, svg);
    }

    // Events to track and restore fold nodes.
    instance.hooks.toggleNode.tap(this.trackFoldNodes.bind(this, handler));
    instance.hooks.beforeRender.tap(this.restoreFoldNodes.bind(this, handler));

    // Event to track SVG zoom and position.
    // We want to start after the SVG render animation ends.
    later(
      this,
      () => {
        if (this.isDestroyed || this.isDestroying) {
          return;
        }
        instance.hooks.onZoom.tap(this.trackSvgPosition.bind(this, handler));
      },
      options.duration
    );

    // Removes the transition effect after the first render
    // to avoid a flickering effect when the SVG is refreshed.
    if (!this.markmapInstance.isFirstRender(handler)) {
      instance.setOptions({ duration: 0 });
    }

    // Sets the data.
    instance.setData(this.markmapInstance.transformHtml(wrapElement));

    // Always fit the SVG the first time and restores the zoom level/position if needed.
    instance.fit(this.lastPosition.get(handler)).then(() => {
      instance.setOptions({ duration: options.duration });
    });

    if (isPreview) {
      this.previousSVGInComposer.set(handler, svg);
    }

    this.markmapToolbar.insertToolbar(handler, svgWrapper, attrs);

    this.handleFeatures({
      wrapElement,
      svg,
      handler,
      isPreview,
      options,
      attrs,
    });

    return instance;
  }

  handleFeatures({ wrapElement, svg, handler, isPreview, options, attrs }) {
    // Delay a little to process after others components / plugins.
    schedule("afterRender", async () => {
      if (!isPreview) {
        this.handleLightbox({ wrapElement });
        this.handleCheckbox({ wrapElement, svg });
        this.handleTable({ wrapElement, svg, attrs });
      }

      Promise.all([
        this.handleMath({ wrapElement, svg }),
        this.handleMermaid({ wrapElement, svg }),
      ]).finally(() => {
        this.markmapInstance.refreshTransform(
          wrapElement,
          this.lastPosition.get(handler)
        );

        this.handleMermaid({ wrapElement, svg, updateStyle: true });
      });
    });

    if (isPreview) {
      // Forces the editor scroll position to match the markmap height.
      document
        .querySelector(".d-editor-input")
        .dispatchEvent(new CustomEvent("scroll"));
    } else {
      // If we unfold a node, we need to reattach events.
      this.markmapInstance
        .lookup(handler)
        ?.hooks.toggleNode.tap(({ expand }) => {
          if (expand) {
            later(
              this,
              () => {
                if (this.isDestroyed || this.isDestroying) {
                  return;
                }
                this.handleLightbox({ wrapElement });
                this.handleCheckbox({ wrapElement, svg });
                this.handleTable({ wrapElement, svg, attrs });
              },
              options.duration
            );
          }
        });
    }
  }

  createWrapper({ handler, index, width, height, isPreview }) {
    const svgWrapper = document.createElement("div");
    svgWrapper.classList.add("markmap-wrapper");
    svgWrapper.dataset.index = index;
    svgWrapper.dataset.handler = handler;

    let svg;

    if (isPreview) {
      svg = this.previousSVGInComposer.get(handler);
    }

    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("markmap");
      svg.dataset.index = index;
      svg.dataset.handler = handler;
    }

    svg.style.width = width;
    svg.style.height = height;

    svgWrapper.append(svg);

    return [svgWrapper, svg];
  }

  /**
   * Handles the lightbox in the SVG foreign element.
   */
  handleLightbox({ wrapElement }) {
    if (this.siteSettings.enable_experimental_lightbox) {
      const modalElement = document.querySelector(
        ".d-modal.fullscreen-markmap-modal"
      );

      if (modalElement) {
        setupLightboxes({
          container: modalElement,
          selector: SELECTORS.DEFAULT_ITEM_SELECTOR,
        });
      } else {
        // This is a workaround to avoid hidden images in [wrap=markmap] element to appear in the lightbox.
        // It's easier to remove any duplicated images when the lightbox is opened,
        // rather than renaming element classnames or calling cleanupLightboxes() then calling setupLightboxes()
        // with a custom selector depending on whenever decorateCookedElement() here is called.
        this.appEvents.on(
          LIGHTBOX_APP_EVENT_NAMES.OPEN,
          ({ items /*, startingIndex, callbacks, options */ }) => {
            const seen = new Set();
            items.splice(
              0,
              items.length,
              ...items.filter((item) => {
                return (
                  item.downloadURL &&
                  !seen.has(item.downloadURL) &&
                  seen.add(item.downloadURL)
                );
              })
            );
          }
        );
      }
    } else {
      lightbox(wrapElement.parentNode, this.siteSettings);
    }
  }

  /**
   * Handles the checkbox events in the SVG foreign element.
   */
  handleCheckbox({ wrapElement, svg }) {
    if (!this.siteSettings.checklist_enabled) {
      return;
    }

    const checkboxElements = wrapElement.querySelectorAll(".chcklst-box");

    if (!checkboxElements.length) {
      return;
    }

    const checkboxElementsInSvg = Array.from(
      svg.querySelectorAll(`foreignObject .chcklst-box`)
    );

    checkboxElements.forEach((checkboxElement) => {
      if (!checkboxElement.onclick) {
        return;
      }

      const checkboxInSvg = checkboxElementsInSvg.find(
        (el) => el.dataset.index === checkboxElement.dataset.index
      );

      if (checkboxInSvg) {
        checkboxInSvg.onclick = checkboxElement.onclick;
      }
    });
  }

  /**
   * Handles the table click event to edit in a modal.
   */
  handleTable({ svg, attrs }) {
    svg.querySelectorAll(".md-table").forEach((table) => {
      // Restores the edit button event.
      const buttonElement = table.querySelector(
        ".fullscreen-table-wrapper__buttons > button"
      );

      if (buttonElement) {
        buttonElement.addEventListener(
          "click",
          generateSpreadsheetModal.bind({
            tableIndex: table.getAttribute("data-table-index"),
            modalService: this.modal,
            ...attrs,
          }),
          false
        );
      }
    });
  }

  /**
   * Handles the MathJax rendering in the SVG foreign element.
   */
  async handleMath({ wrapElement }) {
    return new Promise((resolve) => {
      if (
        !this.siteSettings.discourse_math_enabled ||
        !wrapElement.querySelector(".math")
      ) {
        resolve();
        return;
      }

      let observers = [];
      let promises = [];

      if (this.siteSettings.discourse_math_provider === "mathjax") {
        wrapElement.querySelectorAll(".math").forEach((mathElement, index) => {
          const scriptElement = mathElement.nextSibling?.lastChild;

          // .innertText used in the plugin doesn't work on hidden element.
          if (scriptElement && !scriptElement.textContent) {
            scriptElement.textContent = mathElement.textContent;
          }

          promises.push(
            new Promise((mathResolve) => {
              observers[index] = new MutationObserver((mutations) => {
                const mutation = mutations[0];
                const target = mutation.target;

                if (!target.getAttribute("style")?.includes("display: none")) {
                  return;
                }

                observers[index].disconnect();
                mathResolve();
              });

              observers[index].observe(mathElement, {
                childList: true,
                subtree: true,
                attributeFilter: ["style"],
              });
            })
          );
        });
      } else if (this.siteSettings.discourse_math_provider === "katex") {
        wrapElement
          .querySelectorAll(".math:not(.math-container)")
          .forEach((mathElement, index) => {
            promises.push(
              new Promise((mathResolve) => {
                observers[index] = new MutationObserver((mutations) => {
                  mutations.forEach((mutation) => {
                    if (
                      mutation.type === "childList" &&
                      mutation.addedNodes.length > 0 &&
                      mutation.addedNodes[0].classList.contains("katex")
                    ) {
                      observers[index].disconnect();
                      next(mathResolve);
                    }
                  });
                });

                observers[index].observe(mathElement, {
                  childList: true,
                  subtree: true,
                  attributeFilter: ["class"],
                });
              })
            );
          });
      }

      Promise.all(promises).finally(() => next(resolve));
    });
  }

  /**
   * Handles the Mermaid rendering in the SVG foreign element.
   */
  handleMermaid({ wrapElement, svg, updateStyle }) {
    return new Promise((resolve) => {
      if (updateStyle) {
        svg
          .querySelectorAll("pre[data-code-wrap='mermaid']")
          .forEach((element) => {
            const mermaidSvg = element.firstChild;
            const mermaidStyle = mermaidSvg.firstChild;

            const oldId = mermaidSvg.id;
            const newId = `${oldId}_markmap`;
            mermaidSvg.id = newId;
            mermaidStyle.textContent = mermaidStyle.textContent.replaceAll(
              oldId,
              newId
            );

            mermaidSvg.querySelectorAll("g marker").forEach((marker) => {
              marker.id = marker.id.replace(oldId, newId);
            });

            mermaidSvg.querySelectorAll("g path").forEach((pathElement) => {
              const markerStart = pathElement.getAttribute("marker-start");
              const markerMid = pathElement.getAttribute("marker-mid");
              const markerEnd = pathElement.getAttribute("marker-end");

              if (markerStart) {
                pathElement.setAttribute(
                  "marker-start",
                  markerStart.replace(oldId, newId)
                );
              }
              if (markerMid) {
                pathElement.setAttribute(
                  "marker-mid",
                  markerMid.replace(oldId, newId)
                );
              }

              if (markerEnd) {
                pathElement.setAttribute(
                  "marker-end",
                  markerEnd.replace(oldId, newId)
                );
              }
            });
          });

        resolve();
        return;
      }

      const mermaidElements = wrapElement.querySelectorAll(
        'pre[data-code-wrap="mermaid"]'
      );

      if (!mermaidElements.length) {
        resolve();
        return;
      }

      let observers = [];
      let promises = [];

      const applyWidthStyle = (element) => {
        if (!element.firstChild) {
          return;
        }
        const { width } = element.firstChild.getBoundingClientRect();
        element.style.width = `${width}px`;
      };

      mermaidElements.forEach((element, index) => {
        promises.push(
          new Promise((mermaidResolve) => {
            if (element.dataset.processed) {
              applyWidthStyle(element);
              mermaidResolve();
            } else {
              observers[index] = new MutationObserver((mutations) =>
                mutations.forEach((mutation) => {
                  observers[index]?.disconnect();
                  applyWidthStyle(mutation.target);
                  mermaidResolve();
                })
              );

              observers[index].observe(element, {
                attributes: true,
                attributeFilter: ["data-processed"],
              });
            }
          })
        );
      });

      Promise.all(promises).finally(resolve);
    });
  }

  trackSvgPosition(handler, { transform }) {
    this.lastPosition.set(handler, transform);
  }

  restoreFoldNodes(handler, { context, options }) {
    if (options.action === "click" || !this.foldNodesState.has(handler)) {
      return;
    }

    const nodesSate = this.foldNodesState.get(handler);

    walkTree(context.state.data, (item, _next) => {
      if (nodesSate.hasOwnProperty(item.state.path)) {
        item.payload = {
          ...item.payload,
          fold: nodesSate[item.state.path] ? 1 : 0,
        };
      }
      _next();
    });
  }

  trackFoldNodes(handler, { expand, recursive, data }) {
    if (!this.foldNodesState.has(handler)) {
      this.foldNodesState.set(handler, {});
    }

    const nodeState = this.foldNodesState.get(handler);

    if (recursive) {
      walkTree(data, (item, _next) => {
        if (item.payload?.hasComment) {
          nodeState[item.state.path] = !expand;
        }
        _next();
      });

      return;
    }

    nodeState[data.state.path] = !expand;
  }

  isPreview(element = null) {
    return element
      ? element.classList.contains("d-editor-preview")
      : document.querySelector(".d-editor-preview") !== null;
  }

  resetStateOnComposer(data) {
    const postId = data.model?.post?.id;
    if (!postId) {
      return;
    }

    [this.lastPosition, this.foldNodesState].forEach((map) => {
      map.keys().forEach((key) => {
        if (key.startsWith("composer") || key.startsWith(`post_${postId}`)) {
          map.delete(key);
        }
      });
    });
  }

  uniqueKey(isPreview, post = null) {
    return post && !isPreview ? `post_${post.id}` : "composer";
  }

  clear() {
    if (this.isPreview()) {
      return;
    }

    this.previousSVGInComposer.clear();
    this.foldNodesState.clear();
    this.lastPosition.clear();
  }
}
