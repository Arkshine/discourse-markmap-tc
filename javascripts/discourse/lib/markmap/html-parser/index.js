import { walkTree } from "../common";

const Levels = {
  None: 0,
  H1: 1,
  H2: 2,
  H3: 3,
  H4: 4,
  H5: 5,
  H6: 6,
  Block: 7,
  List: 8,
  ListItem: 9,
};

const defaultSelectorRules = {
  ".lightbox-wrapper,.image-wrapper,.md-table": ({ $node, getContent }) => {
    return {
      ...getContent($node),
    };
  },
  "div,p,a.lightbox": ({ $node }) => ({
    queue: $node.children,
  }),
  "h1,h2,h3,h4,h5,h6": ({ $node, getContent }) => ({
    ...getContent($node.childNodes),
  }),
  "ul,ol": ({ $node }) => ({
    queue: $node.children,
    nesting: true,
  }),
  li: ({ $node, getContent }) => {
    const queue = Array.from($node.children).filter((child) =>
      child.matches("ul,ol")
    );

    let content;

    if ($node.firstNode?.matches("div,p")) {
      content = getContent($node.firstNode);
    } else {
      let $contents = Array.from($node.childNodes);
      const i = $contents.findIndex((child) => queue.includes(child));

      if (i >= 0) {
        $contents = $contents.slice(0, i);
      }

      content = getContent($contents);
    }
    return {
      queue,
      nesting: true,
      ...content,
    };
  },
  "table,pre,p>img:only-child": ({ $node, getContent }) => ({
    ...getContent($node),
  }),
};

export const defaultOptions = {
  selector:
    "h1,h2,h3,h4,h5,h6,ul,ol,li,table,.md-table,pre,.image-wrapper,.lightbox-wrapper,p>img:only-child",
  selectorRules: defaultSelectorRules,
};

const MARKMAP_COMMENT_PREFIX = "markmap: ";
const SELECTOR_HEADING = /^h[1-6]$/;
const SELECTOR_LIST = /^[uo]l$/;
const SELECTOR_LIST_ITEM = /^li$/;

function getLevel(tagName) {
  if (SELECTOR_HEADING.test(tagName)) {
    return Levels[`H${tagName[1]}`];
  }

  if (SELECTOR_LIST.test(tagName)) {
    return Levels.List;
  }

  if (SELECTOR_LIST_ITEM.test(tagName)) {
    return Levels.ListItem;
  }

  return Levels.Block;
}

export function parseHtml(html, opts = {}) {
  const options = {
    ...defaultOptions,
    ...opts,
  };

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const $root = doc.body;
  let id = 0;

  const rootNode = {
    id,
    tag: "",
    html: "",
    level: Levels.None,
    parent: 0,
    childrenLevel: Levels.None,
    children: [],
  };

  const headingStack = [];
  let skippingHeading = Levels.None;
  checkNodes(Array.from($root.children));

  return rootNode;

  function addChild(props) {
    const { parent } = props;
    const node = {
      id: ++id,
      tag: props.tagName,
      level: props.level,
      html: props.html,
      childrenLevel: Levels.None,
      children: props.nesting ? [] : undefined,
      parent: parent.id,
    };

    if (props.comments?.length) {
      node.comments = props.comments;
    }

    if (Object.keys(props.data || {}).length) {
      node.data = props.data;
    }

    if (parent.children) {
      if (
        parent.childrenLevel === Levels.None ||
        parent.childrenLevel > node.level
      ) {
        parent.children = [];
        parent.childrenLevel = node.level;
      }
      if (parent.childrenLevel === node.level) {
        parent.children.push(node);
      }
    }

    return node;
  }

  function getCurrentHeading(level) {
    let heading;

    while ((heading = headingStack.at(-1)) && heading.level >= level) {
      headingStack.pop();
    }

    return heading || rootNode;
  }

  function getContent($node) {
    const result = extractMagicComments(
      Array.isArray($node)
        ? $node
        : $node instanceof NodeList
        ? Array.from($node)
        : [$node]
    );

    const outputHtml = result.$node
      .map((node) => {
        return node.outerHTML || node.textContent;
      })
      .join("")
      .trimEnd();

    return { comments: result.comments, html: outputHtml };
  }

  function extractMagicComments($node) {
    const comments = [];

    $node = $node.filter((child) => {
      if (child.nodeType === "comment") {
        const data = child.data().trim();
        if (data.startsWith(MARKMAP_COMMENT_PREFIX)) {
          comments.push(data.slice(MARKMAP_COMMENT_PREFIX.length).trim());
          return false;
        }
      }
      return true;
    });

    return { $node, comments };
  }

  function checkNodes($els, parentNode) {
    $els.forEach((child) => {
      const rule = Object.entries(options.selectorRules).find(([selector]) =>
        child.matches(selector)
      )?.[1];

      const result = rule?.({ $node: child, getContent });

      if (result?.queue && !result.nesting) {
        checkNodes(Array.from(result.queue), parentNode);
        return;
      }

      const tagName = child.tagName.toLowerCase();
      const level = getLevel(tagName);

      if (!result) {
        if (level <= Levels.H6) {
          skippingHeading = level;
        }
        return;
      }

      if (skippingHeading > Levels.None && level > skippingHeading) {
        return;
      }

      if (!child.matches(options.selector)) {
        return;
      }

      skippingHeading = Levels.None;
      const isHeading = level <= Levels.H6;

      let data = child?.dataset || {};

      if (child.querySelector("code:only-child")) {
        Object.assign(data, child.querySelector("code").dataset);
      }

      const childNode = addChild({
        parent: parentNode || getCurrentHeading(level),
        nesting: !!result.queue || isHeading,
        tagName,
        level,
        html: result.html || "",
        comments: result.comments,
        data,
      });

      if (isHeading) {
        headingStack.push(childNode);
      }

      if (result.queue) {
        checkNodes(Array.from(result.queue), childNode);
      }
    });
  }
}

export function convertNode(htmlRoot) {
  return walkTree(htmlRoot, (htmlNode, next) => {
    const node = {
      content: htmlNode.html,
      children: next() || [],
    };

    if (htmlNode.data) {
      node.payload = {
        ...htmlNode.data,
      };
    }

    if (htmlNode.comments) {
      if (htmlNode.comments.includes("foldAll")) {
        node.payload = { ...node.payload, fold: 2 };
      } else if (htmlNode.comments.includes("fold")) {
        node.payload = { ...node.payload, fold: 1 };
      }
    }

    return node;
  });
}

export function buildTree(html, opts) {
  const htmlRoot = parseHtml(html, opts);
  return convertNode(htmlRoot);
}
