import { buildTree } from "./html-parser";

function cleanNode(node) {
  while (!node.content && node.children.length === 1) {
    node = node.children[0];
  }

  while (node.children.length === 1 && !node.children[0].content) {
    node = {
      ...node,
      children: node.children[0].children,
    };
  }

  return {
    ...node,
    children: node.children.map(cleanNode),
  };
}

class Transformer {
  transform(html, opts) {
    const context = {
      html,
      features: {},
      contentLineOffset: 0,
    };

    const root = cleanNode(
      buildTree(html, {
        ...opts,
      })
    );

    root.content ||= `${opts.title || ""}`;
    return { ...context, root };
  }
}

export { Transformer };
