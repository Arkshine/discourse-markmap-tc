import {
  addClass,
  childSelector,
  debounce,
  getId,
  noop,
  walkTree,
} from "../common";
import Hook from "../common/hook";
import { defaultOptions, isMacintosh } from "./constants";

const containerCSS = `
    /* used for pre-rendering to get the size of each node */
    .markmap-container {
      position: absolute;
      width: 0;
      height: 0;
      top: -100px;
      left: -100px;
      overflow: hidden;
    }
    .markmap-container > .markmap-foreign {
      display: inline-block;
    }
    .markmap-container > .markmap-foreign > div {
      /* first-child for line wrapping, last-child for max-width detection */
      margin: 0;
      padding: 0;
    }
    .markmap-container > .markmap-foreign > div .md-table td {
      padding: 3px 3px 3px 2em;
    }
    .markmap-container > .markmap-foreign > div .image-wrapper {
      display: grid;
    }
    .markmap-container > .markmap-foreign > div .button-wrapper {
      padding: .25em .5em;
      min-width: 19em;
      height: var(--resizer-height, 2.25em);
    }
    .markmap-container > .markmap-foreign > div > img {
      padding-bottom: 5px;
    }
    .markmap-container > .markmap-foreign > div:last-child {
      /* override base CSS */
    }
    .markmap-container > .markmap-foreign > div:last-child,
    .markmap-container > .markmap-foreign > div:last-child :not(pre) {
      white-space: nowrap;
    }
    .markmap-container > .markmap-foreign > div:last-child code {
      white-space: inherit;
    }
  `;

const css = ``;

export const globalCSS = css;

function linkWidth(nodeData) {
  const data = nodeData.data;
  return Math.max(4 - 2 * data.state.depth, 1.5);
}

function minBy(numbers, by) {
  const index = window.d3.minIndex(numbers, by);
  return numbers[index];
}

function stopPropagation(event) {
  event.stopPropagation();
}

/**
 * A global hook to refresh all markmaps when called.
 */
export const refreshHook = new Hook();

export class Markmap {
  static create(svg, opts, data = null) {
    const mm = new Markmap(svg, opts);
    if (data) {
      mm.setData(data);
      mm.fit(); // always fit for the first render
    }
    return mm;
  }

  options = defaultOptions;

  revokers = [];
  imgCache = {};

  handleZoom = (event) => {
    const { transform } = event;
    this.g.attr("transform", transform);

    this.hooks.onZoom.call({
      context: this,
      transform,
    });
  };

  handlePan = (event) => {
    event.preventDefault();

    const transform = window.d3.zoomTransform(this.svg.node());
    const newTransform = transform.translate(
      -event.deltaX / transform.k,
      -event.deltaY / transform.k
    );

    this.svg.call(this.zoom.transform, newTransform);
  };

  handleClick = (event, d) => {
    let recursive = this.options.toggleRecursively;

    if (isMacintosh ? event.metaKey : event.ctrlKey) {
      recursive = !recursive;
    }

    this.toggleNode(d.data, recursive, { action: "click" });
  };

  constructor(svg, opts) {
    this.svg = svg.datum ? svg : window.d3.select(svg);
    this.styleNode = this.svg.append("style");

    this.zoom = window.d3
      .zoom()
      /* fixed: Uncaught DOMException: Failed to read the 'value' property from 'SVGLength'
      .extent([
        [0, 0],
        [300, 300],
      ])*/
      .filter((event) => {
        if (this.options.scrollForPan) {
          // Pan with wheels, zoom with ctrl+wheels
          if (event.type === "wheel") {
            return event.ctrlKey && !event.button;
          }
        }
        return (!event.ctrlKey || event.type === "wheel") && !event.button;
      })
      .on("zoom", this.handleZoom);

    // Move the default color option here because scaleOrdinal needs to be preloaded and d3 is lazy loaded.
    const defaultColorFn = window.d3.scaleOrdinal(window.d3.schemeCategory10);
    this.options.color = (node) => defaultColorFn(node.state.path);

    this.setOptions(opts);

    this.state = {
      id: this.options.id || this.svg.attr("id") || getId(),
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
    };

    this.g = this.svg.append("g");

    this.debouncedRefresh = debounce(() => this.setData(), 200);

    this.hooks = {
      beforeRender: new Hook(),
      afterRender: new Hook(),
      toggleNode: new Hook(),
      onZoom: new Hook(),
    };

    this.revokers.push(
      refreshHook.tap(() => {
        this.setData();
      })
    );
  }

  getStyleContent() {
    const { style } = this.options;
    const { id } = this.state;

    const styleText = typeof style === "function" ? style(id) : "";

    return [this.options.embedGlobalCSS && css, styleText]
      .filter(Boolean)
      .join("\n");
  }

  updateStyle() {
    this.svg.attr(
      "class",
      addClass(this.svg.attr("class"), "markmap", this.state.id)
    );

    const style = this.getStyleContent();

    this.styleNode.text(style);
  }

  toggleNode(data, recursive = false, options = {}) {
    const fold = data.payload?.fold ? 0 : 1;
    if (recursive) {
      // recursively
      walkTree(data, (item, next) => {
        item.payload = {
          ...item.payload,
          fold,
        };
        next();
      });
    } else {
      data.payload = {
        ...data.payload,
        fold: data.payload?.fold ? 0 : 1,
      };
    }

    this.hooks.toggleNode.call({
      context: this,
      expand: !fold,
      recursive,
      data,
      options,
    });

    this.renderData(data, options);
  }

  initializeData(node) {
    let nodeId = 0;
    const { color, nodeMinHeight, maxWidth, initialExpandLevel } = this.options;
    const { id } = this.state;

    const vContainer = document.createDocumentFragment();
    const containerDiv = document.createElement("div");
    containerDiv.className = `markmap-container markmap ${id}-g`;
    vContainer.appendChild(containerDiv);

    const vStyle = document.createDocumentFragment();
    const styleElement = document.createElement("style");
    styleElement.textContent = [this.getStyleContent(), containerCSS].join(
      "\n"
    );
    vStyle.appendChild(styleElement);

    // Get the first child of each fragment (the actual elements)
    const container = vContainer.firstChild;
    const style = vStyle.firstChild;

    const groupStyle = maxWidth ? `--markmap-max-width: ${maxWidth}px` : "";

    let foldRecursively = 0;
    let depth = 0;

    walkTree(node, (item, next, parent) => {
      depth += 1;
      item.children = item.children?.map((child) => ({ ...child }));
      nodeId += 1;

      const group = document.createElement("div");
      group.className = "markmap-foreign markmap-foreign-testing-max"; // Set the class name
      group.style = groupStyle;

      const innerDiv = document.createElement("div");
      innerDiv.innerHTML = item.content;

      group.appendChild(innerDiv);
      container.append(group);

      item.state = {
        ...item.state,
        depth,
        id: nodeId,
        el: group.firstChild,
      };

      item.state.path = [parent?.state?.path, item.state.id]
        .filter(Boolean)
        .join(".");

      color(item); // preload colors

      const isFoldRecursively = item.payload?.fold === 2;

      if (isFoldRecursively) {
        foldRecursively += 1;
      } else if (
        foldRecursively ||
        (initialExpandLevel >= 0 && item.state.depth >= initialExpandLevel)
      ) {
        item.payload = { ...item.payload, fold: 1 };
      }

      next();

      if (isFoldRecursively) {
        foldRecursively -= 1;
      }

      depth -= 1;
    });

    document.body.append(container, style);

    const nodes = Array.from(container.childNodes).map(
      (group) => group.firstChild
    );

    this._checkImages(container);

    // Clone the rendered HTML and set `white-space: nowrap` to it to detect its max-width.
    // The parent node will have a width of the max-width and the original content without
    // `white-space: nowrap` gets re-layouted, then we will get the expected layout, with
    // content in one line as much as possible, and subjecting to the given max-width.
    nodes.forEach((childNode) => {
      childNode.parentNode?.append(childNode.cloneNode(true));
    });

    walkTree(node, (item, next, parent) => {
      const state = item.state;
      const rect = state.el.getBoundingClientRect();

      item.content = state.el.innerHTML;

      state.size = [
        Math.ceil(rect.width) + 1,
        Math.max(Math.ceil(rect.height), nodeMinHeight),
      ];

      state.key =
        [parent?.state?.id, state.id].filter(Boolean).join(".") +
        // FIXME: find a way to check content hash
        item.content;

      next();
    });

    ///container.remove();
    //style.remove();
  }

  _checkImages(container) {
    container.querySelectorAll("img").forEach((img) => {
      if (img.width) {
        return;
      }

      const size = this.imgCache[img.src];

      if (size?.[0]) {
        [img.width, img.height] = size;
      } else if (!size) {
        this._loadImage(img.src);
      }
    });
  }

  _loadImage(src) {
    this.imgCache[src] = [0, 0];

    const img = new Image();
    img.src = src;
    img.onload = () => {
      this.imgCache[src] = [img.naturalWidth, img.naturalHeight];
      this.debouncedRefresh();
    };
  }

  setOptions(opts) {
    this.options = {
      ...this.options,
      ...opts,
    };

    if (this.options.zoom) {
      this.svg.call(this.zoom);
    } else {
      this.svg.on(".zoom", null);
    }

    if (this.options.pan) {
      this.svg.on("wheel", this.handlePan, { passive: true });
    } else {
      this.svg.on("wheel", null);
    }
  }

  setData(data, opts) {
    if (opts) {
      this.setOptions(opts);
    }

    if (data) {
      this.state.data = data;
    }

    if (!this.state.data) {
      return;
    }

    this.initializeData(this.state.data);
    this.updateStyle();
    this.renderData();
  }

  renderData(originData, options = {}) {
    if (!this.state.data) {
      return;
    }

    this.hooks.beforeRender.call({
      context: this,
      originData,
      options,
    });

    const { spacingHorizontal, paddingX, spacingVertical, autoFit, color } =
      this.options;

    const layout = window.d3
      .flextree({})
      .children((d) => {
        if (!d.payload?.fold) {
          return d.children;
        }
      })
      .nodeSize((node) => {
        const [width, height] = node.data.state.size;
        return [height, width + (width ? paddingX * 2 : 0) + spacingHorizontal];
      })
      .spacing((a, b) => {
        return a.parent === b.parent ? spacingVertical : spacingVertical * 2;
      });

    const tree = layout.hierarchy(this.state.data);

    layout(tree);

    const descendants = tree.descendants().reverse();
    const links = tree.links();
    const linkShape = window.d3.linkHorizontal();
    const minX = window.d3.min(descendants, (d) => d.x - d.xSize / 2);
    const maxX = window.d3.max(descendants, (d) => d.x + d.xSize / 2);
    const minY = window.d3.min(descendants, (d) => d.y);
    const maxY = window.d3.max(
      descendants,
      (d) => d.y + d.ySize - spacingHorizontal
    );
    Object.assign(this.state, {
      minX,
      maxX,
      minY,
      maxY,
    });

    if (autoFit) {
      this.fit();
    }

    const origin =
      (originData && descendants.find((item) => item.data === originData)) ||
      tree;
    const x0 = origin.data.state.x0 ?? origin.x;
    const y0 = origin.data.state.y0 ?? origin.y;

    // Update the nodes
    const node = this.g
      .selectAll(childSelector("g"))
      .data(descendants, (d) => d?.data.state.key);

    const nodeEnter = node
      .enter()
      .append("g")
      .attr("data-depth", (d) => d.data.state.depth)
      .attr("data-path", (d) => d.data.state.path)
      .attr(
        "transform",
        (d) =>
          `translate(${y0 + origin.ySize - d.ySize},${
            x0 + origin.xSize / 2 - d.xSize
          })`
      );

    const nodeExit = this.transition(node.exit());

    nodeExit
      .select("line")
      .attr("x1", (d) => {
        if (!d) {
          return;
        }
        return d.ySize - spacingHorizontal;
      })
      .attr("x2", (d) => {
        if (!d) {
          return;
        }
        return d.ySize - spacingHorizontal;
      });
    nodeExit.select("foreignObject").style("opacity", 0);
    nodeExit
      .attr(
        "transform",
        (d) =>
          `translate(${origin.y + origin.ySize - d.ySize},${
            origin.x + origin.xSize / 2 - d.xSize
          })`
      )
      .remove();

    const nodeMerge = node
      .merge(nodeEnter)
      .attr("class", (d) =>
        ["markmap-node", d.data.payload?.fold && "markmap-fold"]
          .filter(Boolean)
          .join(" ")
      );

    this.transition(nodeMerge).attr(
      "transform",
      (d) => `translate(${d.y},${d.x - d.xSize / 2})`
    );

    // Update lines under the content
    const line = nodeMerge
      .selectAll(childSelector("line"))
      .data(
        (d) => [d],
        (d) => d.data.state.key
      )
      .join(
        (enter) => {
          return enter
            .append("line")
            .attr("x1", (d) => d.ySize - spacingHorizontal)
            .attr("x2", (d) => d.ySize - spacingHorizontal);
        },
        (update) => update,
        (exit) => exit.remove()
      );

    this.transition(line)
      .attr("x1", -1)
      .attr("x2", (d) => d.ySize - spacingHorizontal + 2)
      .attr("y1", (d) => d.xSize)
      .attr("y2", (d) => d.xSize)
      .attr("stroke", (d) => color(d.data))
      .attr("stroke-width", linkWidth);

    // Circle to link to children of the node
    const circle = nodeMerge
      .selectAll(childSelector("circle"))
      .data(
        (d) => (d.data.children?.length ? [d] : []),
        (d) => d.data.state.key
      )
      .join(
        (enter) => {
          return enter
            .append("circle")
            .attr("stroke-width", "1.5")
            .attr("cx", (d) => d.ySize - spacingHorizontal)
            .attr("cy", (d) => d.xSize)
            .attr("r", 0)
            .on("click", (e, d) => this.handleClick(e, d))
            .on("mousedown", stopPropagation);
        },
        (update) => update,
        (exit) => exit.remove()
      );

    this.transition(circle)
      .attr("r", 6)
      .attr("cx", (d) => d.ySize - spacingHorizontal)
      .attr("cy", (d) => d.xSize)
      .attr("stroke", (d) => color(d.data))
      .attr("fill", (d) =>
        d.data.payload?.fold && d.data.children
          ? color(d.data)
          : "var(--markmap-circle-open-bg)"
      );

    const foreignObject = nodeMerge
      .selectAll(childSelector("foreignObject"))
      .data(
        (d) => [d],
        (d) => d.data.state.key
      )
      .join(
        (enter) => {
          const fo = enter
            .append("foreignObject")
            .attr("class", "markmap-foreign")
            .attr("x", paddingX)
            .attr("y", 0)
            .style("opacity", 0)
            .on("mousedown", stopPropagation)
            .on("dblclick", stopPropagation);

          fo.append("xhtml:div")
            .select(function select(d) {
              const clone = d.data.state.el.cloneNode(true);
              this.replaceWith(clone);
              return clone;
            })
            .attr("xmlns", "http://www.w3.org/1999/xhtml");

          return fo;
        },
        (update) => update,
        (exit) => exit.remove()
      )
      .attr(
        "width",
        (d) => Math.max(0, d.ySize - spacingHorizontal - paddingX * 2 + 2) // Added extra 2 for table
      )
      .attr("height", (d) => d.xSize);

    this.transition(foreignObject).style("opacity", 1);

    // Update the links
    const path = this.g
      .selectAll(childSelector("path"))
      .data(links, (d) => d?.target.data.state.key)
      .join(
        (enter) => {
          const source = [
            y0 + origin.ySize - spacingHorizontal,
            x0 + origin.xSize / 2,
          ];
          return enter
            .insert("path", "g")
            .attr("class", "markmap-link")
            .attr("data-depth", (d) => d.target.data.state.depth)
            .attr("data-path", (d) => d.target.data.state.path)
            .attr("d", linkShape({ source, target: source }));
        },
        (update) => update,
        (exit) => {
          const source = [
            origin.y + origin.ySize - spacingHorizontal,
            origin.x + origin.xSize / 2,
          ];
          return this.transition(exit)
            .attr("d", linkShape({ source, target: source }))
            .remove();
        }
      );

    this.transition(path)
      .attr("stroke", (d) => color(d.target.data))
      .attr("stroke-width", (d) => linkWidth(d.target))
      .attr("d", (d) => {
        const origSource = d.source;
        const origTarget = d.target;

        const source = [
          origSource.y + origSource.ySize - spacingHorizontal,
          origSource.x + origSource.xSize / 2,
        ];

        const target = [origTarget.y, origTarget.x + origTarget.xSize / 2];

        return linkShape({ source, target });
      });

    descendants.forEach((d) => {
      d.data.state.x0 = d.x;
      d.data.state.y0 = d.y;
    });

    this.hooks.afterRender.call({
      context: this,
      originData,
    });
  }

  transition(sel) {
    const { duration } = this.options;
    return sel.transition().duration(duration);
  }

  /**
   * Fit the content to the viewport.
   */
  async fit(zoomIdentity = null) {
    if (zoomIdentity) {
      const { x, y, k } = zoomIdentity;

      return this.transition(this.svg)
        .call(
          this.zoom.transform,
          window.d3.zoomIdentity.translate(x, y).scale(k)
        )
        .end()
        .catch(noop);
    } else {
      const svgNode = this.svg.node();
      const { width: offsetWidth, height: offsetHeight } =
        svgNode.getBoundingClientRect();
      const { fitRatio } = this.options;
      const { minX, maxX, minY, maxY } = this.state;
      const naturalWidth = maxY - minY;
      const naturalHeight = maxX - minX;
      const scale = Math.min(
        (offsetWidth / naturalWidth) * fitRatio,
        (offsetHeight / naturalHeight) * fitRatio,
        2
      );
      const initialZoom = window.d3.zoomIdentity
        .translate(
          (offsetWidth - naturalWidth * scale) / 2 - minY * scale,
          (offsetHeight - naturalHeight * scale) / 2 - minX * scale
        )
        .scale(scale);

      return this.transition(this.svg)
        .call(this.zoom.transform, initialZoom)
        .end()
        .catch(noop);
    }
  }

  findElementByPath(path) {
    return this.g
      .selectAll(childSelector("g"))
      .filter(`[data-path="${path}"]`)
      .datum();
  }

  /**
   * Pan the content to make the provided node visible in the viewport.
   */
  async ensureView(path, padding) {
    const itemData = this.findElementByPath(path);

    if (!itemData) {
      return;
    }

    const svgNode = this.svg.node();
    const { spacingHorizontal } = this.options;

    const relRect = svgNode.getBoundingClientRect();
    const transform = window.d3.zoomTransform(svgNode);

    const [left, right] = [
      itemData.y,
      itemData.y + itemData.ySize - spacingHorizontal + 2,
    ].map((x) => x * transform.k + transform.x);

    const [top, bottom] = [
      itemData.x - itemData.xSize / 2,
      itemData.x + itemData.xSize / 2,
    ].map((y) => y * transform.k + transform.y);

    // Skip if the node includes or is included in the container.
    const pd = {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      ...padding,
    };

    const dxs = [pd.left - left, relRect.width - pd.right - right];
    const dys = [pd.top - top, relRect.height - pd.bottom - bottom];
    const dx = dxs[0] * dxs[1] > 0 ? minBy(dxs, Math.abs) / transform.k : 0;
    const dy = dys[0] * dys[1] > 0 ? minBy(dys, Math.abs) / transform.k : 0;

    if (dx || dy) {
      const newTransform = transform.translate(dx, dy);
      return this.transition(this.svg)
        .call(this.zoom.transform, newTransform)
        .end()
        .catch(noop);
    }
  }

  /**
   * Scale content with it pinned at the center of the viewport.
   */
  async rescale(scale) {
    const svgNode = this.svg.node();
    const { width: offsetWidth, height: offsetHeight } =
      svgNode.getBoundingClientRect();
    const halfWidth = offsetWidth / 2;
    const halfHeight = offsetHeight / 2;
    const transform = window.d3.zoomTransform(svgNode);
    const newTransform = transform
      .translate(
        ((halfWidth - transform.x) * (1 - scale)) / transform.k,
        ((halfHeight - transform.y) * (1 - scale)) / transform.k
      )
      .scale(scale);
    return this.transition(this.svg)
      .call(this.zoom.transform, newTransform)
      .end()
      .catch(noop);
  }

  destroy() {
    this.svg.on(".zoom", null);
    this.svg.html(null);
    this.revokers.forEach((fn) => {
      fn();
    });
  }
}
