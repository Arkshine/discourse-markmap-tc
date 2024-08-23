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

  lastMathResolve = {};
  previousSVGInComposer = {};
  #foldNodesState = {};
  #lastPosition = {};

  init() {
    super.init();
    this.#handleDarkmode();
  }

  applyMarkmaps(element, key = "composer", attrs = {}) {
    const markmaps = element.querySelectorAll('[data-wrap="markmap"]');

    if (!markmaps.length) {
      element
        .querySelectorAll(".markmap-wrapper")
        .forEach((wrapper) => wrapper.remove());
      return;
    }

    this.#ensureLibraries().then(() => {
      const isPreview = element.classList.contains("d-editor-preview");

      markmaps.forEach((wrapElement, index) => {
        this.#beforeRender(wrapElement);
        this.#render({
          wrapElement,
          index,
          isPreview,
          attrs,
          key,
        });
      });
    });
  }

  async #ensureLibraries() {
    await loadScript(settings.theme_uploads_local.d3_js);
    await loadScript(settings.theme_uploads_local.d3_flextree_js);
  }

  #beforeRender(wrapElement) {
    if (this.siteSettings.checklist_enabled) {
      // Marks the checklist items to find them later in the proper order.
      wrapElement.querySelectorAll(".chcklst-box").forEach((element, index) => {
        element.dataset.index = index;
      });
    }
  }

  #render({ wrapElement, index, isPreview, attrs, key }) {
    if (!wrapElement || wrapElement.dataset.processed) {
      return;
    }

    if (
      isPreview &&
      wrapElement.nextSibling?.nodeType === Node.ELEMENT_NODE &&
      wrapElement.nextSibling.classList.contains("markmap-wrapper")
    ) {
      wrapElement.nextSibling.remove();
    }

    const options = this.markmapInstance.deriveOptions(wrapElement.dataset);
    const handler = `${key}.${index}`;

    // Wrapper to contain SVG and toolbar.
    const [svgWrapper, svg] = this.createWrapper({
      handler,
      index,
      width: "100%",
      height: `${options.height}px` || "500px",
    });

    this.#handleDarkmode(svgWrapper);

    wrapElement.parentElement.insertBefore(svgWrapper, wrapElement.nextSibling);
    wrapElement.setAttribute("aria-hidden", "true");
    wrapElement.dataset.index = index;
    wrapElement.dataset.handler = handler;
    wrapElement.dataset.processed = true;

    this.#createMarkmap({
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
      height: "calc(100vh - 70px - 3rem)",
    });

    containerElement.append(svgWrapper);

    this.#createMarkmap({
      wrapElement,
      svgWrapper,
      svg,
      attrs,
      handler: "modal",
      isPreview: false,
      options: {},
    });
  }

  #createMarkmap({
    wrapElement,
    svgWrapper,
    svg,
    attrs,
    handler,
    isPreview,
    options,
  }) {
    let instance;

    if (this.previousSVGInComposer[handler]) {
      instance = this.markmapInstance.lookup(handler);
    } else {
      instance = this.markmapInstance.create(handler, svg, options);
    }

    // Removes the transition effect after the first render
    // to avoid flickering effect when the SVG is refreshed.
    if (!this.markmapInstance.isFirstRender(handler)) {
      instance.setOptions({ duration: 0 });
      instance.hooks.afterRender.tap(() =>
        next(() => instance.setOptions({ duration: options.duration }))
      );
    }

    // Events to track and restore fold nodes.
    instance.hooks.toggleNode.tap(this.#trackFoldNodes.bind(this, handler));
    instance.hooks.beforeRender.tap(this.#restoreFoldNodes.bind(this, handler));

    // Event to track SVG zoom and position.
    // We want to start after the SVG render animation ends.
    later(
      this,
      () =>
        instance.hooks.onZoom.tap(this.#trackSvgPosition.bind(this, handler)),
      options.duration
    );

    // Sets the data.
    instance.setData(this.markmapInstance.transformHtml(wrapElement));

    // Always fit the SVG the first time and restores the zoom level/position if needed.
    instance.fit(this.#lastPosition[handler]);

    if (isPreview) {
      this.previousSVGInComposer[handler] = svg;
    }

    this.markmapInstance.insertToolbar(handler, svgWrapper, attrs);

    this.#handleFeatures({ wrapElement, svg, handler, isPreview, attrs });
  }

  /**
   * Fixes a few Discourse features.
   */
  #handleFeatures({ wrapElement, svg, handler, isPreview, attrs }) {
    // Delay a little to process after others components / plugins.
    schedule("afterRender", async () => {
      if (!isPreview) {
        this.#handleLightbox({ wrapElement });
        this.#handleCheckbox({ wrapElement, svg });
        this.#handleTable({ wrapElement, svg, attrs });
      }

      Promise.all([
        this.#handleMath({ wrapElement, svg }),
        this.#handleMermaid({ wrapElement, svg }),
      ]).finally(() => {
        //this.appEvents.trigger("markmap:rendered", { wrapElement, svg });

        this.markmapInstance.refreshTransform(
          wrapElement,
          this.#lastPosition[handler]
        );

        this.#handleMermaid({ wrapElement, svg, updateStyle: true });
      });

      next(() => {});
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
            this.#handleLightbox({ wrapElement });
            this.#handleCheckbox({ wrapElement, svg });
            this.#handleTable({ wrapElement, svg, attrs });
          }
        });
    }
  }

  createWrapper({ handler, index, width, height }) {
    const svgWrapper = document.createElement("div");
    svgWrapper.classList.add("markmap-wrapper");
    svgWrapper.dataset.index = index;
    svgWrapper.dataset.handler = handler;

    let svg = this.previousSVGInComposer[handler];

    if (!svg) {
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.classList.add("markmap");
      svg.dataset.index = index;
      svg.dataset.handler = handler;
      svg.style.width = width;
      svg.style.height = height;
    }

    svgWrapper.append(svg);

    return [svgWrapper, svg];
  }

  /**
   * Handles the lightbox in the SVG foreign element.
   */
  #handleLightbox({ wrapElement }) {
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
  #handleCheckbox({ wrapElement, svg }) {
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
   * Handles the table positioning and click event to edit in a modal.
   */
  #handleTable({ wrapElement, svg, attrs }) {
    svg.querySelectorAll(".md-table").forEach((table, index) => {
      const foreignElement = table.closest(".markmap-foreign");

      const maxWith = parseInt(wrapElement.dataset.maxWidth, 10);
      const isTableOverflowOnX = maxWith > 0 && table.clientWidth >= maxWith;

      // As long as the table is not overflowing horizontally (usually happens with a maxWidth)
      // we force nowrap to make sure everything is visible.
      if (!isTableOverflowOnX) {
        table.style.whiteSpace = "nowrap";
      }

      // If the table is overflowing vertically between the foreign element and the table
      // We move up the table with the difference between the two heights.
      const tableRectHeight = table.getBoundingClientRect().height;
      const foreignElementRectHeight =
        foreignElement.getBoundingClientRect().height;

      if (tableRectHeight > foreignElementRectHeight) {
        table.style.marginTop = `-${
          Math.ceil(tableRectHeight - foreignElementRectHeight) + 1
        }px`;
      }

      // Restores the edit button event.
      const buttonElement = table.querySelector(
        ".fullscreen-table-wrapper__buttons > button"
      );

      if (buttonElement) {
        buttonElement.addEventListener(
          "click",
          generateSpreadsheetModal.bind({
            tableIndex: index,
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
  async #handleMath({ wrapElement, svg }) {
    return new Promise((resolve) => {
      if (
        !this.siteSettings.discourse_math_enabled ||
        !wrapElement.querySelector(".math")
      ) {
        resolve();
        return;
      }

      if (this.siteSettings.discourse_math_provider === "mathjax") {
        const mathElements = wrapElement.querySelectorAll(
          '.math:not([data-markmap-pass="true"]'
        );
        mathElements.forEach((mathElement) => {
          mathElement.nextSibling.dataset.markmap = true;

          const scriptElement = mathElement.nextSibling.lastChild;

          // .innertText used in the plugin doesn't work on hidden element.
          if (!scriptElement.textContent) {
            scriptElement.textContent = mathElement.textContent;
          }
        });

        // The math plugin doesn't render the math expression
        // if the element is hidden.
        later(this, () => {
          //const promise = new Promise((typesetsResolve) => {
          /*window.MathJax.Hub.Queue(() => {
            let allJax = window.MathJax.Hub.getAllJax(wrapElement).map(
              (jax) => jax.inputID
            );

            if (allJax.length === 0) {
              resolve();
              return;
            }

            if (this.lastMathResolve[wrapElement.dataset.handler]) {
              //this.lastMathResolve[wrapElement.dataset.handler].resolve();
            }

            this.lastMathResolve[wrapElement.dataset.handler] = {
              allJax,
              resolve,
              rendered: 0,
            };

            function waitForRender(message) {
              const element = message[1];

              if (!element.parentElement.dataset.markmap) {
                return;
              }

              const { inputID } = window.MathJax.Hub.getJaxFor(element);
              const handler = element.parentElement.closest(
                `[data-wrap="markmap"]`
              )?.dataset.handler;

              if (
                handler &&
                this.lastMathResolve[handler].allJax.includes(inputID)
              ) {
                ++this.lastMathResolve[handler].rendered;

                if (
                  this.lastMathResolve[handler].rendered >=
                  this.lastMathResolve[handler].allJax.length
                ) {
                  resolve();
                }
              }
            }

            if (this.#mathJaxHook === null) {
              this.#mathJaxHook = window.MathJax.Hub.Register.MessageHook(
                "End Process",
                waitForRender.bind(this)
              );
            }
          });*/
          /*const instance = this.markmapInstance.lookup(
              wrapElement.dataset.handler
            );

            const gElement = document
              .querySelector("svg.markmap .math")
              .closest("g");

            instance.ensureView(gElement.dataset.path);*/
          //resolve();
        });
      } else if (this.siteSettings.discourse_math_provider === "katex") {
        // Wait for the math expression to be rendered
        // so we can refresh the SVG.
        const mathElements = Array.from(wrapElement.querySelectorAll(".math"));
        const lastElement = mathElements.findLast(
          (element) => !element.classList.contains("math-container")
        );

        if (!lastElement) {
          resolve();
        } else {
          const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
              if (
                mutation.type === "childList" &&
                mutation.addedNodes.length > 0 &&
                mutation.addedNodes[0].classList.contains("katex")
              ) {
                resolve();
              }
            });
          });

          observer.observe(lastElement, {
            childList: true,
            subtree: true,
            attributeFilter: ["class"],
          });
        }
      }
    });
  }

  /**
   * Handles the Mermaid rendering in the SVG foreign element.
   */
  #handleMermaid({ wrapElement, svg, updateStyle }) {
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
        const { width } = element.firstChild.getBoundingClientRect();
        element.style.width = `${width}px`;
      };

      // Wait for all the mermaid charts to be rendered.
      // Redraws the SVG to define the mermaid width before refreshing the SVG.
      mermaidElements.forEach((element, index) => {
        promises.push(
          new Promise((mermaidResolve) => {
            if (element.dataset.processed) {
              applyWidthStyle(element);
              mermaidResolve();
            } else {
              const observer = (observers[index] = new MutationObserver(
                (mutations) =>
                  mutations.forEach((mutation) => {
                    observers[index]?.disconnect();
                    applyWidthStyle(mutation.target);
                    mermaidResolve();
                  })
              ));

              observer.observe(element, {
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

  /**
   * Handles the dark mode in the SVG foreign element.
   */
  #handleDarkmode(svgWrapper) {
    if (svgWrapper) {
      if (
        getComputedStyle(document.body)
          .getPropertyValue("--scheme-type")
          .trim() === "dark"
      ) {
        svgWrapper.classList.add("markmap-dark");
      }

      return;
    }

    const darkScheme =
      document.querySelector("link.dark-scheme") ||
      document.querySelector("link#cs-preview-dark");

    if (!darkScheme) {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      if (mutations.length) {
        document.querySelectorAll(".markmap-wrapper").forEach((element) => {
          element.classList.toggle(
            "markmap-dark",
            mutations[0].target.media === "all"
          );
        });
      }
    });

    observer.observe(darkScheme, {
      attributes: true,
      attributeFilter: ["media"],
    });
  }

  #trackSvgPosition(handler, { transform }) {
    this.#lastPosition[handler] = transform;
  }

  #restoreFoldNodes(handler, { context, originData }) {
    if (originData || !this.#foldNodesState[handler]) {
      return;
    }

    walkTree(context.state.data, (item, _next) => {
      if (this.#foldNodesState[handler][item.state.path]) {
        item.payload = {
          ...item.payload,
          fold: 1,
        };
      }

      _next();
    });
  }

  #trackFoldNodes(handler, { expand, data }) {
    this.#foldNodesState[handler] = this.#foldNodesState[handler] || {};
    this.#foldNodesState[handler][data.state.path] = !expand;
  }
}
