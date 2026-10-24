import * as React from "react";
import Image from "next/image";

import { getProjectIconUrl } from "./project-icons";
import { cn } from "@/lib/utils";

type ProjectIconProps = Omit<
  React.ComponentProps<typeof Image>,
  "src" | "width" | "height" | "alt"
> & {
  iconId?: string;
  alt?: string;
};

function ProjectIcon({ iconId, alt = "", className, ...props }: ProjectIconProps) {
  return (
    <Image
      src={getProjectIconUrl(iconId)}
      alt={alt}
      width={512}
      height={512}
      sizes="36px"
      draggable={false}
      className={cn("block shrink-0 select-none", className)}
      {...props}
    />
  );
}

export { ProjectIcon };
export type { ProjectIconProps };
