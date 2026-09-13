// ANSI colors
export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
export const DIM = '\x1b[2m';
export const GREEN = '\x1b[32m';
export const BLUE = '\x1b[34m';
export const CYAN = '\x1b[36m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';
export const MAGENTA = '\x1b[35m';

export const c = {
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  blue: (s: string) => `${BLUE}${s}${RESET}`,
  cyan: (s: string) => `${CYAN}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  magenta: (s: string) => `${MAGENTA}${s}${RESET}`,
  gray: (s: string) => `${DIM}${s}${RESET}`,
  underline: (s: string) => `\x1b[4m${s}${RESET}`,
};
