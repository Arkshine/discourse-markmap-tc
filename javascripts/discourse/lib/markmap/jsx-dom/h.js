import { VTYPE_ELEMENT, VTYPE_FUNCTION } from "./consts";

export const isLeaf = (c) => typeof c === "string" || typeof c === "number";
export const isElement = (c) =>
  (c == null ? void 0 : c.vtype) === VTYPE_ELEMENT;
export const isRenderFunction = (c) =>
  (c == null ? void 0 : c.vtype) === VTYPE_FUNCTION;

export function h(type, props, ...children) {
  props = Object.assign({}, props, {
    children: children.length === 1 ? children[0] : children,
  });

  return jsx(type, props);
}

function jsx(type, props) {
  let vtype;

  if (typeof type === "string") {
    vtype = VTYPE_ELEMENT;
  } else if (typeof type === "function") {
    vtype = VTYPE_FUNCTION;
  } else {
    throw new Error("Invalid VNode type");
  }

  return {
    vtype,
    type,
    props,
  };
}

export const jsxs = jsx;

export function Fragment(props) {
  return props.children;
}
