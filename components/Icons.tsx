import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>;
}

export function MenuIcon(props: IconProps) { return <IconBase {...props}><path d="M4 7h16M4 12h16M4 17h16" /></IconBase>; }
export function UploadIcon(props: IconProps) { return <IconBase {...props}><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" /></IconBase>; }
export function PlayIcon(props: IconProps) { return <IconBase {...props}><path d="m9 7 8 5-8 5V7Z" /></IconBase>; }
export function ClockIcon(props: IconProps) { return <IconBase {...props}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 1.5" /></IconBase>; }
export function SparkIcon(props: IconProps) { return <IconBase {...props}><path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8-1.8 5.9-1.8-5.9-5.7-1.8L10.2 9 12 3.5Z" /></IconBase>; }
export function SearchIcon(props: IconProps) { return <IconBase {...props}><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 4 4" /></IconBase>; }
export function CloseIcon(props: IconProps) { return <IconBase {...props}><path d="m6 6 12 12M18 6 6 18" /></IconBase>; }
export function DownloadIcon(props: IconProps) { return <IconBase {...props}><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" /></IconBase>; }
export function ExpandIcon(props: IconProps) { return <IconBase {...props}><path d="M8 4H4v4m12-4h4v4M8 20H4v-4m16 4h-4v-4" /></IconBase>; }
export function ChevronLeftIcon(props: IconProps) { return <IconBase {...props}><path d="m14 6-6 6 6 6" /></IconBase>; }
export function PlusIcon(props: IconProps) { return <IconBase {...props}><path d="M12 5v14M5 12h14" /></IconBase>; }
