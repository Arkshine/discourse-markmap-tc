import { later, next, schedule } from "@ember/runloop";
import Service, { service } from "@ember/service";
import lightbox, { setupLightboxes } from "discourse/lib/lightbox";
import {
  LIGHTBOX_APP_EVENT_NAMES,
  SELECTORS,
} from "discourse/lib/lightbox/constants";
import loadScript from "discourse/lib/load-script";
import { iconHTML } from "discourse-common/lib/icon-library";
import { bind } from "discourse-common/utils/decorators";
import OptionsMarkmap from "../components/modal/options-markmap";
import { md5 } from "../lib/discourse/md5";
import { generateSpreadsheetModal } from "../lib/discourse/table";
import { walkTree } from "../lib/markmap/common";

const UID_POST_PREFIX = "post_";
const UID_COMPOSER_PREFIX = "composer";

export default class MarkmapManager extends Service {
  @service modal;
  @service siteSettings;
  @service appEvents;
  @service markmapInstance;
  @service markmapToolbar;

  previousSVGInComposer = new Map();
  previousWrapElementInComposerMd5 = new Map();
  foldNodesState = new Map();
  lastPosition = new Map();
  canTrackPosition = new Map();
  refreshingContent = new Map();

  currentPostId;

  constructor() {
    super(...arguments);
    this.appEvents.on("composer:open", this, this.onComposerOpen);
    this.appEvents.on("composer:will-close", this, this.onComposerClose);
  }

  willDestroy() {
    this.appEvents.off("composer:open", this, this.onComposerOpen);
    this.appEvents.off("composer:will-close", this, this.onComposerClose);
    super.willDestroy(...arguments);
  }

  applyMarkmaps(element, isPreview, postId, attrs = {}) {
    const markmaps = element.querySelectorAll('[data-wrap="markmap"]');

    if (!markmaps.length) {
      if (isPreview) {
        element
          .querySelectorAll(".markmap-wrapper")
          .forEach((wrapper) => wrapper.remove());
      }
      return;
    }

    this.ensureLibraries().then(() => {
      markmaps.forEach((wrapElement, index) => {
        this.beforeRender(wrapElement);
        this.render({
          wrapElement,
          index,
          isPreview,
          postId,
          attrs,
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

  render({ wrapElement, index, isPreview, postId, attrs }) {
    if (!wrapElement || wrapElement.dataset.processed) {
      return;
    }

    if (isPreview) {
      wrapElement.parentElement
        .querySelector(`.markmap-wrapper[data-index="${index}"]`)
        ?.remove();
    }

    const options = this.markmapInstance.deriveOptions(wrapElement.dataset);
    const handler = this.uniqueKey({ isPreview, index, postId });

    options.index = index;
    options.postId = postId;

    // Wrapper to contain SVG and toolbar.
    const [svgWrapper, svg, svgWasLoaded] = this.createWrapper({
      handler,
      index,
      width: "100%",
      height: `${
        this.markmapInstance.dynamicOpts.get(handler)?.autoFitHeight ||
        options.maxHeight
      }px`,
      isPreview,
    });

    wrapElement.parentElement.insertBefore(svgWrapper, wrapElement.nextSibling);
    wrapElement.setAttribute("aria-hidden", "true");
    wrapElement.dataset.index = index;
    wrapElement.dataset.handler = handler;
    wrapElement.dataset.processed = true;

    this.markmapToolbar.insertToolbar({
      handler,
      svgWrapper,
      isPreview,
      attrs,
    });

    if (this.markmapToolbar.contentDisplayed) {
      wrapElement.classList.add("content-displayed");

      if (
        md5(wrapElement.innerHTML) !==
        this.previousWrapElementInComposerMd5.get(handler)
      ) {
        document
          .querySelector(".d-editor-input")
          .dispatchEvent(new CustomEvent("scroll"));
      }
      return;
    }

    return this.createMarkmap({
      wrapElement,
      svgWrapper,
      svg,
      svgWasLoaded,
      attrs,
      handler,
      isPreview,
      options,
    });
  }

  renderInModal({ index = -1, containerElement, wrapElement, attrs = {} }) {
    const handler = "modal";

    let svgWrapper, svg;
    svgWrapper = containerElement.querySelector(".markmap-wrapper");

    if (svgWrapper) {
      svg = svgWrapper.querySelector("svg");
    } else {
      [svgWrapper, svg] = this.createWrapper({
        handler,
        index,
        width: "100%",
        height: "100vh",
      });

      containerElement.append(svgWrapper);
    }

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
    svgWasLoaded,
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

    this.markmapInstance.trackRenderCount(handler);
    this.markmapToolbar.insertToolbar({
      handler,
      svgWrapper,
      isPreview,
      attrs,
    });

    // Events to track and restore fold nodes, and zoom/position.
    instance.hooks.toggleNode.tap(this.trackFoldNodes.bind(this, handler));
    instance.hooks.beforeRender.tap(this.restoreFoldNodes.bind(this, handler));
    instance.hooks.onZoom.tap(this.trackSvgPosition.bind(this, handler));

    if (
      isPreview &&
      svgWasLoaded &&
      md5(wrapElement.innerHTML) !==
        this.previousWrapElementInComposerMd5.get(handler)
    ) {
      // Forces a refresh if the content inside [wrap] has changed.
      // Overwrites regardless if we are displaying the original content.
      svgWasLoaded = this.markmapToolbar.contentDisplayed;
    }

    const firstRender = this.markmapInstance.isFirstRender(handler);
    const lastPosition = this.lastPosition.get(handler);

    // Sets the data.
    // Always refresh the content on the first render.
    if (firstRender || !svgWasLoaded) {
      const transformedHtml = this.markmapInstance.transformHtml(wrapElement);

      if (firstRender) {
        instance.setData(transformedHtml);
        instance.fit();
      } else {
        instance.setData(transformedHtml, { duration: 0 }); // Remove animation after the first render.
        instance
          .fit(lastPosition)
          .then(() => instance.setOptions({ duration: options.duration }));
      }
    }

    if (isPreview) {
      this.previousSVGInComposer.set(handler, svg);
      this.previousWrapElementInComposerMd5.set(
        handler,
        md5(wrapElement.innerHTML)
      );

      this.insertOptionButtonOnPreview({
        handler,
        index: options.index,
        svgWrapper,
      });
    }

    let triggerScroll = false;

    // Fixes a few Discourse features.
    if (firstRender || !svgWasLoaded) {
      this.handleFeatures({
        wrapElement,
        svg,
        handler,
        isPreview,
        options,
        attrs,
        instance,
      }).then(async () => {
        if (!isPreview) {
          this.markmapInstance
            .refreshTransform(wrapElement, lastPosition)
            .then(() => {
              this.canTrackPosition.set(handler, true);
            });
        } else {
          if (firstRender) {
            this.markmapInstance.autoFitHeight(wrapElement, options);
          } else {
            this.canTrackPosition.set(handler, true);
          }

          triggerScroll = true;
        }
      });
    } else {
      // SVG can be only loaded in composer context.
      if (firstRender) {
        this.markmapInstance.autoFitHeight(wrapElement, options);
      } else {
        instance.fit(this.lastPosition.get(handler));
      }

      triggerScroll = true;
    }

    if (triggerScroll) {
      document
        .querySelector(".d-editor-input")
        .dispatchEvent(new CustomEvent("scroll"));
    }

    return instance;
  }

  handleFeatures({ wrapElement, svg, handler, isPreview, options, attrs }) {
    // If we unfold a node, we need to reattach events.
    this.markmapInstance.lookup(handler)?.hooks.toggleNode.tap(({ expand }) => {
      if (expand) {
        later(
          this,
          () => {
            if (this.isDestroyed || this.isDestroying) {
              return;
            }

            if (!(isPreview || this.inFullScreen)) {
              this.handleLightbox({ wrapElement });
              this.handleCheckbox({ wrapElement, svg });
              this.handleTable({ wrapElement, svg, attrs });
            }

            this.handleMermaid({ wrapElement, svg, updateStyle: true });
          },
          options.duration
        );
      }
    });

    return new Promise((resolve) => {
      schedule("afterRender", () => {
        if (!(isPreview || this.inFullScreen)) {
          this.handleLightbox({ wrapElement });
          this.handleCheckbox({ wrapElement, svg });
          this.handleTable({ wrapElement, svg, attrs });
        }

        if (isPreview) {
          const refresh = async ({ runBefore, runAfter }) => {
            if (this.refreshingContent.get(handler)) {
              return Promise.resolve();
            }

            this.refreshingContent.set(handler, true);

            await runBefore();
            await this.markmapInstance.refreshTransform(
              wrapElement,
              this.lastPosition.get(handler)
            );

            if (runAfter) {
              await runAfter();
            }

            this.refreshingContent.set(handler, false);

            return Promise.resolve();
          };

          // Since these features rendering time can vary,
          // we want to display them as soon as possible in the composer.
          const promises = [
            refresh({
              wrapElement,
              runBefore: () => this.handleMermaid({ wrapElement, svg }),
              runAfter: () =>
                this.handleMermaid({
                  wrapElement,
                  svg,
                  updateStyle: true,
                }),
            }),

            refresh({
              wrapElement,
              runBefore: () => this.handleMath({ wrapElement, svg }),
            }),
          ];

          Promise.all(promises).then(resolve);
        } else {
          later(
            this,
            () => {
              if (this.isDestroyed || this.isDestroying) {
                return;
              }

              const promises = [
                this.handleMermaid({ wrapElement, svg }),
                this.handleMath({ wrapElement, svg }),
              ];

              Promise.all(promises)
                .then(resolve)
                .finally(() => {
                  this.handleMermaid({
                    wrapElement,
                    svg,
                    updateStyle: true,
                  });
                });
            },
            this.markmapInstance.isFirstRender(handler) ? options.duration : 0
          );
        }
      });
    });
  }

  createWrapper({ handler, index, width, height, isPreview }) {
    const svgWrapper = document.createElement("div");
    svgWrapper.classList.add("markmap-wrapper");
    svgWrapper.dataset.index = index;
    svgWrapper.dataset.handler = handler;

    let svg;
    let svgWasLoaded = false;

    if (isPreview) {
      svg = this.previousSVGInComposer.get(handler);
      svgWasLoaded = !!svg;
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

    return [svgWrapper, svg, svgWasLoaded];
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
        // rather than renaming element classnames or calling cleanupLightboxes() then setupLightboxes()
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
  handleCheckbox({ wrapElement, svg, direction = "wrapToSvg" }) {
    if (!this.siteSettings.checklist_enabled) {
      return;
    }

    const checkboxElementsInSvg = Array.from(
      svg.querySelectorAll("foreignObject .chcklst-box")
    );
    const checkboxElements = Array.from(
      wrapElement.querySelectorAll(".chcklst-box")
    );

    if (!checkboxElements.length || !checkboxElementsInSvg.length) {
      return;
    }

    const [sourceElements, targetElements] =
      direction === "wrapToSvg"
        ? [checkboxElements, checkboxElementsInSvg]
        : [checkboxElementsInSvg, checkboxElements];

    sourceElements.forEach((sourceElement) => {
      if (!sourceElement.onclick) {
        return;
      }

      const targetElement = targetElements.find(
        (el) => el.dataset.index === sourceElement.dataset.index
      );

      if (targetElement) {
        targetElement.onclick = sourceElement.onclick;
      }
    });
  }

  /**
   * Handles the table click event to edit in a modal.
   */
  handleTable({ wrapElement, svg, attrs, direction = "wrapToSvg" }) {
    const sourceElements =
      direction === "wrapToSvg"
        ? svg.querySelectorAll(".md-table")
        : wrapElement.querySelectorAll(".md-table");

    sourceElements.forEach((table) => {
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
        const mathsElements = wrapElement.querySelectorAll(
          '.math[data-applied-mathjax="true"]'
        );

        mathsElements.forEach((mathElement, index) => {
          const scriptElement = mathElement.nextSibling?.lastChild;

          // .innertText used in the plugin doesn't work on hidden element.
          if (scriptElement && !scriptElement.textContent) {
            scriptElement.textContent = mathElement.textContent;
          }

          promises.push(
            new Promise((mathResolve) => {
              if (
                mathElement.getAttribute("style")?.includes("display: none")
              ) {
                mathResolve();
                return;
              }

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
        const { width, height } = element.firstChild.getBoundingClientRect();
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
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
    if (!this.canTrackPosition.get(handler)) {
      return;
    }

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

  get inFullScreen() {
    return document.querySelector(".d-modal.fullscreen-markmap-modal");
  }

  @bind
  openOptionsModal(event) {
    this.modal.show(OptionsMarkmap, {
      model: {
        element: event.currentTarget,
        postId: this.currentPostId,
      },
    });
  }

  insertOptionButtonOnPreview({ handler, index, svgWrapper }) {
    const optionsWrapper = document.createElement("button");
    optionsWrapper.classList.add(
      "btn",
      "btn-icon",
      "no-text",
      "markmap-options"
    );
    optionsWrapper.dataset.handler = handler;
    optionsWrapper.dataset.index = index;
    optionsWrapper.innerHTML = iconHTML("cog");
    optionsWrapper.addEventListener("click", this.openOptionsModal, {
      passive: true,
    });
    svgWrapper.append(optionsWrapper);
  }

  onComposerOpen(data) {
    document.querySelectorAll(".markmap-options").forEach((optionsWrapper) => {
      optionsWrapper.removeEventListener("click", this.openOptionsModal, {
        passive: true,
      });
    });

    const postId = data.model?.post?.id;
    if (postId) {
      this.currentPostId = postId;

      [this.lastPosition, this.foldNodesState].forEach((map) => {
        map.keys().forEach((key) => {
          if (
            key.startsWith(UID_COMPOSER_PREFIX) ||
            key.startsWith(`${UID_POST_PREFIX}${postId}`)
          ) {
            map.delete(key);
          }
        });
      });
    }
    postId;
  }

  onComposerClose() {
    this.canTrackPosition.keys().forEach((key) => {
      if (key.startsWith(UID_COMPOSER_PREFIX)) {
        this.canTrackPosition.delete(key);
      }
    });

    [this.lastPosition, this.foldNodesState].forEach((map) => {
      map.keys().forEach((key) => {
        if (
          key.startsWith(UID_COMPOSER_PREFIX) ||
          key.startsWith(`${UID_POST_PREFIX}${this.currentPostId}`)
        ) {
          map.delete(key);
        }
      });
    });

    this.currentPostId = null;
  }

  uniqueKey({ isPreview, index, postId }) {
    return postId && !isPreview
      ? `${UID_POST_PREFIX}${postId}.${index}`
      : `${UID_COMPOSER_PREFIX}.${index}`;
  }

  clear() {
    if (this.isPreview()) {
      return;
    }

    this.previousSVGInComposer.clear();
    this.previousWrapElementInComposerMd5.clear();
    this.foldNodesState.clear();
    this.lastPosition.clear();
    this.canTrackPosition.clear();
    this.refreshingContent.clear();

    this.currentPostId = null;
  }
}
