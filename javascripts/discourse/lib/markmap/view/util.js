import { defaultOptions } from "./constants";

export function deriveOptions(jsonOptions) {
  const derivedOptions = {};
  const options = { ...jsonOptions };

  let { color, colorFreezeLevel } = options;

  if (typeof color === "string") {
    color = [color];
  }

  if (color?.length === 1) {
    const solidColor = color[0];
    derivedOptions.color = () => solidColor;
  } else if (color?.length) {
    const colorFn = window.d3.scaleOrdinal(color);
    derivedOptions.color = (node) => {
      return colorFn(`${node.state.path}`);
    };
  }

  if (colorFreezeLevel) {
    const _color = derivedOptions.color || defaultOptions.color;
    derivedOptions.color = (node) => {
      node = {
        ...node,
        state: {
          ...node.state,
          path: node.state.path.split(".").slice(0, colorFreezeLevel).join("."),
        },
      };
      return _color(node);
    };
  }

  const numberKeys = ["duration", "maxWidth", "initialExpandLevel"];

  numberKeys.forEach((key) => {
    const value = options[key];

    if (typeof value === "number") {
      derivedOptions[key] = value;
    } else if (typeof value === "string") {
      derivedOptions[key] = parseInt(value, 10);
    }
  });

  const booleanKeys = ["zoom", "pan"];

  booleanKeys.forEach((key) => {
    const value = options[key];

    if (value != null) {
      derivedOptions[key] = !!parseInt(value, 10);
    }
  });

  const stringKeys = ["autoFit", "height"];

  stringKeys.forEach((key) => {
    derivedOptions[key] = options[key];
  });

  return derivedOptions;
}
