// Why: the accent comes from the theme tokens in globals.css, so every primary button in the
// app changes together. The focus ring uses the same accent, with the lighter one on dark.
export const primaryButtonClass =
  "inline-flex w-fit items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-accent-soft";

export const secondaryButtonClass =
  "inline-flex w-fit items-center rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:border-neutral-700 dark:hover:bg-neutral-900 dark:focus-visible:outline-accent-soft";
