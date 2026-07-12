import type * as React from "react";
import type { AvatarOptions } from "./index.d.ts";

export interface AgentAvatarProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height"> {
  seed: unknown;
  size?: number;
  options?: Omit<AvatarOptions, "size">;
  width?: number | string;
  height?: number | string;
}

export const AgentAvatar: React.ForwardRefExoticComponent<AgentAvatarProps & React.RefAttributes<HTMLImageElement>>;
export const HashAvatar: typeof AgentAvatar;
