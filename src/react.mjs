import * as React from "react";
import { avatarDataUri } from "./index.mjs";

const AgentAvatar = React.forwardRef(function AgentAvatar(props, ref) {
  const {
    seed,
    size = 96,
    options = {},
    alt = "",
    width = size,
    height = size,
    ...imageProps
  } = props;

  const src = avatarDataUri(seed, { ...options, size });
  return React.createElement("img", {
    ...imageProps,
    ref,
    src,
    alt,
    width,
    height,
  });
});

AgentAvatar.displayName = "AgentAvatar";
const HashAvatar = AgentAvatar;

export { AgentAvatar, HashAvatar };
